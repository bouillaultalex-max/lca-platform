#Requires -Version 5.1
<#
Restauration de test PostgreSQL — ADM-11, docs/adr/0009-sauvegardes-automatiques-postgresql.md.

Restaure un fichier produit par backup.ps1 vers une base jetable dédiée, jamais vers une base
de développement/test/production. Sert à la fois :
  - au test mensuel de restauration réelle (ADR 0009, décision 6) ;
  - à une vérification manuelle ponctuelle par l'opérateur.

Ce script ne supprime ni ne modifie jamais lca_mes / lca_mes_dev / lca_mes_test / postgres :
la valeur de -TargetDatabase est vérifiée avant toute action.

Exemple (-NonInteractive recommandé pour un usage non attendu à un clavier, voir backup.ps1) :
  powershell.exe -NoProfile -NonInteractive -File "C:\chemin\vers\scripts\restore.ps1" `
    -BackupFile "D:\Sauvegardes\lca_mes\lca_mes_20260818.dump" `
    -TargetDatabase "lca_mes_restore_test_20260818"

Voir scripts/README.md pour la procédure complète.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $BackupFile,

    [Parameter(Mandatory)]
    [string] $TargetDatabase,

    [string] $PgHost = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
    [int] $PgPort = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
    [string] $PgUser = $(if ($env:PGUSER) { $env:PGUSER } else { 'lca_mes' }),
    [string] $PgBinPath = 'C:\Program Files\PostgreSQL\18\bin',

    # Tables à compter après restauration, à titre de contrôle de cohérence indicatif — liste
    # non exhaustive et non figée (ADR 0009, décision 6). Noms de tables réels (voir
    # apps/api/prisma/schema.prisma, @@map), pas les noms de modèles Prisma.
    [string[]] $CheckTables = @('lots', 'stock_movements', 'lot_genealogies', 'batch_costs', 'users'),

    # Par défaut, la base jetable est conservée après restauration pour inspection manuelle.
    [switch] $DropAfter
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\ExternalTool.ps1')
. (Join-Path $PSScriptRoot 'lib\RestoreVerdict.ps1')

$protectedDatabaseNames = @('lca_mes', 'lca_mes_dev', 'lca_mes_test', 'postgres')
if ($protectedDatabaseNames -contains $TargetDatabase) {
    Write-Error "TargetDatabase '$TargetDatabase' correspond à une base protégée (développement/test/production/système). La restauration de test doit cibler une base jetable dédiée, jamais l'une de ces bases."
    exit 1
}

if (-not (Test-Path -LiteralPath $BackupFile)) {
    Write-Error "Fichier de sauvegarde introuvable : $BackupFile"
    exit 1
}

$psqlExe = Join-Path $PgBinPath 'psql.exe'
$createdbExe = Join-Path $PgBinPath 'createdb.exe'
$dropdbExe = Join-Path $PgBinPath 'dropdb.exe'
$pgRestoreExe = Join-Path $PgBinPath 'pg_restore.exe'

foreach ($exe in @($psqlExe, $createdbExe, $dropdbExe, $pgRestoreExe)) {
    if (-not (Test-Path -LiteralPath $exe)) {
        Write-Error "Outil PostgreSQL introuvable : $exe"
        exit 1
    }
}

Write-Host "Vérification structurelle préalable (pg_restore --list)..."
$listResult = Invoke-ExternalTool -Path $pgRestoreExe -ArgumentList @('--list', $BackupFile)
if ($listResult.ExitCode -ne 0) {
    if ($listResult.Output) { Write-Host ($listResult.Output -join [Environment]::NewLine) }
    Write-Error 'Le fichier de sauvegarde ne passe pas la vérification structurelle (pg_restore --list). Restauration abandonnée.'
    exit 1
}

Write-Host "Création de la base jetable '$TargetDatabase'..."
$createResult = Invoke-ExternalTool -Path $createdbExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, $TargetDatabase)
if ($createResult.ExitCode -ne 0) {
    if ($createResult.Output) { Write-Host ($createResult.Output -join [Environment]::NewLine) }
    Write-Error "Échec de la création de la base '$TargetDatabase' (code retour $($createResult.ExitCode))."
    exit 1
}

Write-Host "Restauration en cours vers '$TargetDatabase'..."
# LC_ALL=C/LC_MESSAGES=C/LANG=C forcés uniquement pour cet appel : sa sortie texte est analysée
# ci-dessous par Get-RestoreVerdict, qui exige un marqueur anglais stable quelle que soit la
# locale du compte exécutant le script (finding IMPORTANT B, voir scripts/lib/ExternalTool.ps1).
# LC_ALL doit être forcé en plus de LC_MESSAGES/LANG : en résolution de locale POSIX/gettext,
# LC_ALL a priorité sur LC_MESSAGES et LANG — s'il reste positionné dans l'environnement ambiant
# (ex. compte Windows configuré en locale française), il écraserait sinon la surcharge C ci-dessous
# et le marqueur redeviendrait localisé, non détectable par la regex de Get-RestoreVerdict (revue
# pr-review-toolkit, finding IMPORTANT « LC_ALL », 2026-08-20 — vérifié empiriquement).
$restoreResult = Invoke-ExternalTool -Path $pgRestoreExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-d', $TargetDatabase, $BackupFile) -EnvironmentOverrides @{ LC_ALL = 'C'; LC_MESSAGES = 'C'; LANG = 'C' }
$restoreExitCode = $restoreResult.ExitCode
$restoreOutputText = $restoreResult.Output -join [Environment]::NewLine
if ($restoreResult.Output) { Write-Host $restoreOutputText }

Write-Host ''
Write-Host 'Comptages de contrôle sur les tables à enjeu (informatifs : un COUNT(*) réussi prouve seulement que la table existe et que la requête est valide, jamais que les données attendues sont réellement présentes — voir scripts/README.md) :'
$countFailureCount = 0
foreach ($table in $CheckTables) {
    $sql = "SELECT COUNT(*) FROM `"$table`";"
    $countResult = Invoke-ExternalTool -Path $psqlExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-d', $TargetDatabase, '-t', '-A', '-c', $sql)
    if ($countResult.ExitCode -eq 0) {
        Write-Host ('  - {0,-20} : {1}' -f $table, (($countResult.Output -join ' ').Trim()))
    } else {
        $countFailureCount++
        Write-Warning ('  - {0,-20} : impossible de compter (table absente ou erreur) : {1}' -f $table, (($countResult.Output -join ' ').Trim()))
    }
}

# Get-RestoreVerdict (scripts/lib/RestoreVerdict.ps1) est la seule source de vérité pour l'état
# ET le code de sortie du script (voir plus bas) : pas de re-dérivation indépendante ailleurs
# dans ce fichier (finding IMPORTANT C).
$restoreVerdict = Get-RestoreVerdict -RestoreExitCode $restoreExitCode -RestoreOutputText $restoreOutputText -CheckTablesCount $CheckTables.Count -CountFailureCount $countFailureCount

Write-Host ''
switch ($restoreVerdict.State) {
    'Success' {
        Write-Host 'VERDICT RESTAURATION : RÉUSSIE SANS AVERTISSEMENT.'
    }
    'ManualReviewRequired' {
        Write-Warning "VERDICT RESTAURATION : VÉRIFICATION MANUELLE OBLIGATOIRE — pg_restore a traité l'archive jusqu'au bout mais a ignoré $($restoreVerdict.IgnoredErrorCount) erreur(s) (code retour $restoreExitCode). Les comptages de contrôle ci-dessus se sont tous exécutés sans erreur, mais un COUNT(*) réussi ne prouve jamais que les données sont réellement présentes ou complètes : comparez-les manuellement à un volume connu avant de faire confiance à cette restauration. Traité comme un échec par ce script (exit 1) tant qu'une vérification humaine explicite n'a pas eu lieu."
    }
    'StructuralFailure' {
        if (-not $restoreVerdict.ReachedEndOfArchive) {
            Write-Warning "VERDICT RESTAURATION : ÉCHEC STRUCTUREL — pg_restore a retourné le code $restoreExitCode sans le message de fin de traitement habituel (« errors ignored on restore ») : signe probable d'un arrêt prématuré (connexion perdue, erreur fatale)."
        } elseif ($CheckTables.Count -eq 0) {
            Write-Warning 'VERDICT RESTAURATION : ÉCHEC STRUCTUREL — aucune table de contrôle configurée (-CheckTables vide) : aucune corroboration possible, traité comme un échec (fail-closed).'
        } else {
            Write-Warning 'VERDICT RESTAURATION : ÉCHEC STRUCTUREL — pg_restore a ignoré des erreurs ET au moins un comptage de contrôle a lui-même échoué (table absente ou requête en erreur) : aucune confirmation possible.'
        }
    }
}

$dropFailed = $false
if ($DropAfter) {
    Write-Host ''
    Write-Host "Suppression de la base jetable '$TargetDatabase' (-DropAfter)..."
    $dropResult = Invoke-ExternalTool -Path $dropdbExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, $TargetDatabase)
    if ($dropResult.Output) { Write-Host ($dropResult.Output -join [Environment]::NewLine) }
    if ($dropResult.ExitCode -ne 0) {
        $dropFailed = $true
        Write-Warning "Échec de la suppression de la base jetable '$TargetDatabase' (code retour $($dropResult.ExitCode)) : elle n'a PAS été supprimée. Nettoyage manuel nécessaire : dropdb -h $PgHost -p $PgPort -U $PgUser $TargetDatabase"
    } else {
        Write-Host "Base jetable '$TargetDatabase' supprimée avec succès."
    }
} else {
    Write-Host ''
    Write-Host "Base jetable conservée pour inspection manuelle : '$TargetDatabase'."
    Write-Host "Pour la supprimer ensuite : dropdb -h $PgHost -p $PgPort -U $PgUser $TargetDatabase"
}

Write-Host ''
if ($restoreVerdict.ExitCode -ne 0 -or $dropFailed) {
    Write-Host 'RÉSULTAT GLOBAL DU SCRIPT : ÉCHEC (exit 1).'
    exit 1
}
Write-Host 'RÉSULTAT GLOBAL DU SCRIPT : SUCCÈS (exit 0).'
exit 0
