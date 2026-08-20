# Classification pure (aucun accès disque ni réseau) du résultat d'une restauration pg_restore,
# conformément à docs/adr/0009-sauvegardes-automatiques-postgresql.md (décision 6).
#
# Isolée ici pour rester testable sans Pester (absent du projet, voir ADR 0009 § Raisons du
# choix), à la manière de lib/BackupRotation.ps1 : scripts/tests/Test-RestoreVerdict.ps1
# dot-source ce fichier et vérifie cette fonction par assertions manuelles, sur le code réel,
# jamais sur une copie.
#
# Origine : revue pr-review-toolkit du 2026-08-19 (finding IMPORTANT A) — la version précédente
# de cette logique, en ligne dans restore.ps1, pouvait classer une restauration
# « RÉUSSIE AVEC AVERTISSEMENTS BÉNINS » (exit 0) alors qu'une table de contrôle avait
# réellement perdu ses données (COPY en échec côté pg_restore, mais SELECT COUNT(*) sur la table
# vide résultante réussit quand même). Un COUNT(*) qui s'exécute sans erreur prouve seulement
# que la table existe et que la requête est valide — jamais que les données attendues sont
# présentes. Cette fonction ne promeut donc plus jamais automatiquement une restauration en
# succès dès lors que pg_restore a ignoré des erreurs : le seul état de sortie possible dans ce
# cas est 'ManualReviewRequired' (jamais 'Success'), pour ne jamais produire de faux succès.

Set-StrictMode -Version Latest

function Get-RestoreVerdict {
    <#
    Détermine l'état final d'une restauration pg_restore à partir de son code retour et de sa
    sortie texte, plus des résultats déjà obtenus des comptages de contrôle. Ne fait aucun appel
    externe : $RestoreOutputText doit avoir été produit par l'appelant avec LC_MESSAGES=C/LANG=C
    forcés sur l'appel pg_restore (voir scripts/lib/ExternalTool.ps1, $EnvironmentOverrides) —
    cette fonction ne tente aucune détection ni traduction multilingue, la stabilité du marqueur
    anglais est une responsabilité de l'appelant, pas de cette fonction.

    Retourne un objet à 3 états fermés, seule source de vérité pour le verdict ET le code de
    sortie (l'appelant ne doit pas re-dériver indépendamment l'un ou l'autre) :
      - 'Success'              : pg_restore a retourné 0. ExitCode = 0.
      - 'ManualReviewRequired' : pg_restore a ignoré des erreurs (code non nul) mais a traité
                                 l'archive jusqu'au bout (marqueur natif présent), ET tous les
                                 comptages de contrôle configurés se sont exécutés sans erreur.
                                 Jamais un succès automatique : un COUNT(*) réussi ne prouve pas
                                 que les données sont réellement présentes ou complètes.
                                 ExitCode = 1.
      - 'StructuralFailure'    : marqueur absent (arrêt prématuré probable), OU aucune table de
                                 contrôle configurée (aucune corroboration possible), OU au moins
                                 un comptage de contrôle a lui-même échoué. ExitCode = 1.
    #>
    param(
        [Parameter(Mandatory)]
        [int] $RestoreExitCode,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $RestoreOutputText,

        [Parameter(Mandatory)]
        [int] $CheckTablesCount,

        [Parameter(Mandatory)]
        [int] $CountFailureCount
    )

    if ($RestoreExitCode -eq 0) {
        return [pscustomobject]@{
            State               = 'Success'
            ExitCode            = 0
            ReachedEndOfArchive = $true
            IgnoredErrorCount   = 0
        }
    }

    $errorsIgnoredMatch = [regex]::Match($RestoreOutputText, 'errors ignored on restore:\s*(\d+)')
    $reachedEndOfArchive = $errorsIgnoredMatch.Success

    if (-not $reachedEndOfArchive) {
        return [pscustomobject]@{
            State               = 'StructuralFailure'
            ExitCode            = 1
            ReachedEndOfArchive = $false
            IgnoredErrorCount   = $null
        }
    }

    $ignoredErrorCount = [int] $errorsIgnoredMatch.Groups[1].Value

    if ($CheckTablesCount -eq 0 -or $CountFailureCount -gt 0) {
        return [pscustomobject]@{
            State               = 'StructuralFailure'
            ExitCode            = 1
            ReachedEndOfArchive = $true
            IgnoredErrorCount   = $ignoredErrorCount
        }
    }

    # Archive traitée jusqu'au bout, tous les comptages exécutables, mais des erreurs ont bien
    # été ignorées : jamais promu en succès (voir note en tête de fichier, finding IMPORTANT A).
    return [pscustomobject]@{
        State               = 'ManualReviewRequired'
        ExitCode            = 1
        ReachedEndOfArchive = $true
        IgnoredErrorCount   = $ignoredErrorCount
    }
}
