# Vérification manuelle, sans dépendance externe (pas de Pester — voir ADR 0009), de la
# logique pure de scripts/lib/RestoreVerdict.ps1. Assertions écrites à la main : PASS/FAIL
# sur la sortie standard, code retour non nul si au moins un scénario échoue.
#
# Ces tests exercent la fonction Get-RestoreVerdict réelle (dot-sourcée depuis
# scripts/lib/RestoreVerdict.ps1), jamais une copie — toute modification future de cette
# fonction est donc couverte par ces assertions sans action manuelle supplémentaire (revue
# pr-review-toolkit, finding IMPORTANT C, 2026-08-19).
#
# Exécution : powershell -File scripts/tests/Test-RestoreVerdict.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\lib\RestoreVerdict.ps1')

$script:failureCount = 0
$script:testCount = 0

function Assert-Equal {
    param(
        [Parameter(Mandatory)][string] $Name,
        $Expected,
        $Actual
    )
    $script:testCount++
    $expectedStr = ($Expected | Out-String).Trim()
    $actualStr = ($Actual | Out-String).Trim()
    if ($expectedStr -eq $actualStr) {
        Write-Host "  PASS - $Name"
    } else {
        $script:failureCount++
        Write-Host "  FAIL - $Name"
        Write-Host "    attendu : $expectedStr"
        Write-Host "    obtenu  : $actualStr"
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory)][string] $Name,
        [bool] $Condition
    )
    Assert-Equal -Name $Name -Expected $true -Actual $Condition
}

Write-Host "=== Get-RestoreVerdict ==="

# 1. Restauration propre : code retour 0, aucune sortie.
$v1 = Get-RestoreVerdict -RestoreExitCode 0 -RestoreOutputText '' -CheckTablesCount 5 -CountFailureCount 0
Assert-Equal -Name '1. Restauration propre : état Success' -Expected 'Success' -Actual $v1.State
Assert-Equal -Name '1. Restauration propre : ExitCode 0' -Expected 0 -Actual $v1.ExitCode

# 2. Erreurs ignorées, tous les comptages de contrôle exécutables : jamais un succès automatique
# (c'est précisément la correction du finding IMPORTANT A — l'ancienne version classait ce cas
# "RÉUSSIE AVEC AVERTISSEMENTS BÉNINS", exit 0).
$conflictOutput = @'
pg_restore: error: could not execute query: ERREUR:  le type « article_type » existe déjà
    Command was: CREATE TYPE public.article_type AS ENUM (
    'MATIERE_PREMIERE',
    'PRODUIT_FINI'
);
pg_restore: warning: errors ignored on restore: 1
'@
$v2 = Get-RestoreVerdict -RestoreExitCode 1 -RestoreOutputText $conflictOutput -CheckTablesCount 5 -CountFailureCount 0
Assert-Equal -Name '2. Erreurs ignorées + comptages tous exécutables : état ManualReviewRequired' -Expected 'ManualReviewRequired' -Actual $v2.State
Assert-Equal -Name '2. Erreurs ignorées + comptages tous exécutables : ExitCode 1' -Expected 1 -Actual $v2.ExitCode
Assert-Equal -Name '2. Erreurs ignorées + comptages tous exécutables : IgnoredErrorCount extrait' -Expected 1 -Actual $v2.IgnoredErrorCount

# 3. Même transcript que #2 (erreurs ignorées, comptages tous exécutables) : reproduction directe
# du bug corrigé — même si les comptages retournaient 0 ligne sur une table réellement vidée par
# un COPY en échec (perte de données réelle), Get-RestoreVerdict ne reçoit que le fait que la
# requête de comptage a réussi (CountFailureCount), jamais la valeur comptée : il ne peut donc
# structurellement plus jamais promouvoir ce cas en 'Success', quelle que soit la donnée réelle
# derrière un comptage qui s'exécute sans erreur.
$v3 = Get-RestoreVerdict -RestoreExitCode 1 -RestoreOutputText $conflictOutput -CheckTablesCount 5 -CountFailureCount 0
Assert-True -Name "3. Erreurs ignorées + comptages exécutables (données potentiellement perdues, ex. table à 0 ligne) : jamais l'état Success" `
    -Condition ($v3.State -ne 'Success')
Assert-Equal -Name '3. Erreurs ignorées + comptages exécutables (perte de données possible) : ExitCode non nul' -Expected 1 -Actual $v3.ExitCode

# 4. Marqueur absent (échec réel, ex. base cible inexistante) : échec structurel.
$failureOutput = @'
pg_restore: error: connection to database "lca_mes_restore_test_absente" failed: FATAL:  la base de données « lca_mes_restore_test_absente » n'existe pas
'@
$v4 = Get-RestoreVerdict -RestoreExitCode 1 -RestoreOutputText $failureOutput -CheckTablesCount 5 -CountFailureCount 0
Assert-Equal -Name '4. Marqueur absent (arrêt prématuré) : état StructuralFailure' -Expected 'StructuralFailure' -Actual $v4.State
Assert-Equal -Name '4. Marqueur absent : ExitCode 1' -Expected 1 -Actual $v4.ExitCode
Assert-Equal -Name '4. Marqueur absent : ReachedEndOfArchive faux' -Expected $false -Actual $v4.ReachedEndOfArchive

# 5. Marqueur présent, mais au moins un comptage de contrôle a lui-même échoué (table absente,
# requête en erreur) : fail-closed, échec structurel malgré l'archive traitée jusqu'au bout.
$v5 = Get-RestoreVerdict -RestoreExitCode 1 -RestoreOutputText $conflictOutput -CheckTablesCount 5 -CountFailureCount 1
Assert-Equal -Name '5. Comptage de contrôle en échec : état StructuralFailure' -Expected 'StructuralFailure' -Actual $v5.State
Assert-Equal -Name '5. Comptage de contrôle en échec : ExitCode 1' -Expected 1 -Actual $v5.ExitCode

# 6. Aucune table de contrôle configurée (-CheckTables vide) : aucune corroboration possible,
# fail-closed, échec structurel même si l'archive a été traitée jusqu'au bout.
$v6 = Get-RestoreVerdict -RestoreExitCode 1 -RestoreOutputText $conflictOutput -CheckTablesCount 0 -CountFailureCount 0
Assert-Equal -Name '6. Aucune table de contrôle configurée : état StructuralFailure' -Expected 'StructuralFailure' -Actual $v6.State
Assert-Equal -Name '6. Aucune table de contrôle configurée : ExitCode 1' -Expected 1 -Actual $v6.ExitCode

# 7. Stabilité du marqueur sous LC_MESSAGES=C : voir scripts/tests/Test-RestoreVerdictLocale.ps1
# (vérification empirique contre un vrai pg_restore, nécessite une instance PostgreSQL — hors du
# périmètre d'une fonction pure sans accès disque/réseau).

# 8. Scénario ambigu : texte qui ressemble au marqueur attendu sans le reproduire exactement (ex.
# préposition différente dans une sortie hypothétique non reconnue) — fail-closed, ne doit jamais
# matcher approximativement.
$ambiguousOutput = @'
pg_restore: warning: errors ignored during restore: 3
'@
$v8 = Get-RestoreVerdict -RestoreExitCode 1 -RestoreOutputText $ambiguousOutput -CheckTablesCount 5 -CountFailureCount 0
Assert-Equal -Name '8. Texte ambigu proche du marqueur sans le reproduire exactement : état StructuralFailure (fail-closed)' -Expected 'StructuralFailure' -Actual $v8.State
Assert-Equal -Name '8. Texte ambigu : ReachedEndOfArchive faux (pas de faux positif de correspondance)' -Expected $false -Actual $v8.ReachedEndOfArchive

# Cas limite supplémentaire : sortie vide avec code retour non nul (ex. pg_restore tué sans
# aucune sortie) — doit rester fail-closed.
$v9 = Get-RestoreVerdict -RestoreExitCode 1 -RestoreOutputText '' -CheckTablesCount 5 -CountFailureCount 0
Assert-Equal -Name '9. Sortie vide + code retour non nul : état StructuralFailure' -Expected 'StructuralFailure' -Actual $v9.State

Write-Host ""
Write-Host "=== Résumé ==="
Write-Host "$($script:testCount) test(s), $($script:failureCount) échec(s)"

if ($script:failureCount -gt 0) {
    exit 1
}
exit 0
