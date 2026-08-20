# Vérification manuelle, sans dépendance externe (pas de Pester — voir ADR 0009), de la
# logique pure de scripts/lib/BackupRotation.ps1. Assertions écrites à la main : PASS/FAIL
# sur la sortie standard, code retour non nul si au moins un scénario échoue.
#
# Exécution : powershell -File scripts/tests/Test-BackupRotation.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\lib\BackupRotation.ps1')

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

function Assert-Throws {
    param(
        [Parameter(Mandatory)][string] $Name,
        [scriptblock] $ScriptBlock
    )
    $script:testCount++
    try {
        & $ScriptBlock
        $script:failureCount++
        Write-Host "  FAIL - $Name (aucune exception levée)"
    } catch {
        Write-Host "  PASS - $Name"
    }
}

function D($yyyymmdd) {
    return [DateTime]::ParseExact($yyyymmdd, 'yyyyMMdd', [System.Globalization.CultureInfo]::InvariantCulture)
}

Write-Host "=== Get-BackupDateStamp / Get-BackupFileName / Get-BackupStagingFileName ==="
Assert-Equal -Name "Formatage de la date en YYYYMMDD" `
    -Expected '20260818' -Actual (Get-BackupDateStamp -Date (D '20260818'))
Assert-Equal -Name "Nom de fichier final" `
    -Expected 'lca_mes_20260818.dump' -Actual (Get-BackupFileName -DateStamp '20260818')
Assert-Equal -Name "Nom de fichier de staging distinct du fichier final" `
    -Expected 'lca_mes_20260818.staging.dump' -Actual (Get-BackupStagingFileName -DateStamp '20260818')

Write-Host ""
Write-Host "=== ConvertFrom-BackupFileName ==="
Assert-Equal -Name "Parse un nom de fichier valide" `
    -Expected (D '20260818') -Actual (ConvertFrom-BackupFileName -FileName 'lca_mes_20260818.dump')
Assert-Equal -Name "Ignore un fichier de staging (ne doit jamais être compté en rétention)" `
    -Expected $null -Actual (ConvertFrom-BackupFileName -FileName 'lca_mes_20260818.staging.dump')
Assert-Equal -Name "Ignore un fichier étranger au dossier" `
    -Expected $null -Actual (ConvertFrom-BackupFileName -FileName 'backup.log')
Assert-Equal -Name "Ignore une date invalide (30 février)" `
    -Expected $null -Actual (ConvertFrom-BackupFileName -FileName 'lca_mes_20260230.dump')
Assert-Equal -Name "Ignore un nom presque valide (7 chiffres au lieu de 8)" `
    -Expected $null -Actual (ConvertFrom-BackupFileName -FileName 'lca_mes_2026081.dump')
Assert-Equal -Name "Ignore un nom presque valide (9 chiffres au lieu de 8)" `
    -Expected $null -Actual (ConvertFrom-BackupFileName -FileName 'lca_mes_202608188.dump')
Assert-Equal -Name "Ignore un nom avec une casse différente (regex sensible à la casse)" `
    -Expected $null -Actual (ConvertFrom-BackupFileName -FileName 'LCA_MES_20260818.DUMP')

Write-Host ""
Write-Host "=== Get-BackupFilesToPurge ==="

Assert-Equal -Name "Moins de 30 sauvegardes : aucune purge" `
    -Expected @() -Actual (Get-BackupFilesToPurge -ValidBackupDates @((D '20260801'), (D '20260802')) -RetentionCount 30)

Assert-Equal -Name "Exactement 30 sauvegardes : aucune purge" `
    -Expected @() -Actual (Get-BackupFilesToPurge -ValidBackupDates @(1..30 | ForEach-Object { (D '20260101').AddDays($_) }) -RetentionCount 30)

$dates31 = 1..31 | ForEach-Object { (D '20260101').AddDays($_) }
$purge31 = Get-BackupFilesToPurge -ValidBackupDates $dates31 -RetentionCount 30
Assert-Equal -Name "31 sauvegardes, rétention 30 : exactement 1 purgée" `
    -Expected 1 -Actual @($purge31).Count
Assert-Equal -Name "31 sauvegardes : la purgée est la plus ancienne" `
    -Expected ($dates31 | Sort-Object | Select-Object -First 1) -Actual $purge31[0]

$mostRecent = ($dates31 | Sort-Object -Descending | Select-Object -First 1)
Assert-True -Name "La sauvegarde la plus récente n'est jamais purgée (même avec 31 sauvegardes)" `
    -Condition (@($purge31) -notcontains $mostRecent)

Assert-True -Name "Dates dupliquées (double exécution le même jour déjà normalisée par le nommage) sans effet sur la purge" `
    -Condition (@(Get-BackupFilesToPurge -ValidBackupDates @((D '20260818'), (D '20260818'), (D '20260817')) -RetentionCount 30).Count -eq 0)

# Dates dupliquées AU-DESSUS du seuil de rétention : la déduplication doit avoir un effet
# observable sur le nombre réel de purges (33 entrées dont 2 doublons parmi 31 dates uniques,
# rétention 30 -> exactement 1 purge attendue, pas 3, si -Unique venait à disparaître).
$dates31WithDuplicates = @($dates31) + @($dates31[0]) + @($dates31[1])
$purgeWithDuplicates = @(Get-BackupFilesToPurge -ValidBackupDates $dates31WithDuplicates -RetentionCount 30)
Assert-Equal -Name "Dates dupliquées au-dessus du seuil de rétention : la déduplication limite bien la purge à 1 (pas 3)" `
    -Expected 1 -Actual $purgeWithDuplicates.Count
Assert-Equal -Name "Dates dupliquées au-dessus du seuil : la date purgée est bien la plus ancienne" `
    -Expected ($dates31 | Sort-Object | Select-Object -First 1) -Actual $purgeWithDuplicates[0]

# Rétention à 1 : vérifie l'identité exacte des dates conservées/purgées, pas seulement leur
# nombre — une régression qui purgerait la mauvaise date (ex. inversion de tri) doit être
# détectée même si le compte final reste correct par coïncidence.
$retention1Dates = @((D '20260101'), (D '20260102'), (D '20260103'))
$retention1Purged = @(Get-BackupFilesToPurge -ValidBackupDates $retention1Dates -RetentionCount 1)
Assert-Equal -Name "Rétention à 1 : nombre de sauvegardes purgées" `
    -Expected 2 -Actual $retention1Purged.Count
Assert-True -Name "Rétention à 1 : la sauvegarde la plus récente (20260103) est conservée, jamais purgée" `
    -Condition ($retention1Purged -notcontains (D '20260103'))
Assert-Equal -Name "Rétention à 1 : l'ensemble exact des dates purgées est {20260101, 20260102}" `
    -Expected (@((D '20260101'), (D '20260102')) | Sort-Object) -Actual ($retention1Purged | Sort-Object)
Assert-Equal -Name "Rétention à 1 : l'ensemble exact des dates conservées est {20260103}" `
    -Expected @((D '20260103')) -Actual (@($retention1Dates) | Where-Object { $retention1Purged -notcontains $_ })

Assert-Equal -Name "Aucune sauvegarde existante : aucune purge, pas d'erreur" `
    -Expected @() -Actual (Get-BackupFilesToPurge -ValidBackupDates @() -RetentionCount 30)

Assert-Throws -Name "RetentionCount invalide (0) lève une exception plutôt que de tout purger" `
    -ScriptBlock { Get-BackupFilesToPurge -ValidBackupDates @(D '20260818') -RetentionCount 0 }

Write-Host ""
Write-Host "=== Test-PathIsWithinDirectory ==="
Assert-True -Name "Fichier réellement à l'intérieur du répertoire de sauvegarde" `
    -Condition (Test-PathIsWithinDirectory -Path 'C:\Backups\lca_mes\lca_mes_20260818.dump' -DirectoryPath 'C:\Backups\lca_mes')
Assert-True -Name "Chemin en dehors du répertoire de sauvegarde rejeté (traversée de répertoire)" `
    -Condition (-not (Test-PathIsWithinDirectory -Path 'C:\Backups\lca_mes\..\..\Windows\System32\config.sys' -DirectoryPath 'C:\Backups\lca_mes'))
Assert-True -Name "Chemin d'un répertoire au nom similaire mais distinct rejeté" `
    -Condition (-not (Test-PathIsWithinDirectory -Path 'C:\Backups\lca_mes_autre\fichier.dump' -DirectoryPath 'C:\Backups\lca_mes'))
Assert-True -Name "Insensibilité à la casse voulue (NTFS/Windows) : un chemin de casse différente reste accepté comme intérieur" `
    -Condition (Test-PathIsWithinDirectory -Path 'C:\Backups\LCA_MES\lca_mes_20260818.dump' -DirectoryPath 'C:\Backups\lca_mes')

Write-Host ""
Write-Host "=== Résumé ==="
Write-Host "$($script:testCount) test(s), $($script:failureCount) échec(s)"

if ($script:failureCount -gt 0) {
    exit 1
}
exit 0
