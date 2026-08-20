#Requires -Version 5.1
<#
Vérification empirique rejouable (nécessite une instance PostgreSQL réelle et accessible, comme
scripts/restore.ps1 lui-même — voir scripts/README.md § Prérequis) que le message natif de
pg_restore lu par Get-RestoreVerdict (scripts/lib/RestoreVerdict.ps1) reste en anglais même
lorsque l'environnement ambiant du compte exécutant le script est configuré en locale française,
grâce à la surcharge LC_ALL=C/LC_MESSAGES=C/LANG=C appliquée par restore.ps1 autour de l'appel
pg_restore concerné (revue pr-review-toolkit, finding IMPORTANT B, 2026-08-19, puis finding
IMPORTANT « LC_ALL », 2026-08-20).

LC_ALL est inclus dans l'environnement ambiant simulé ci-dessous (pas seulement LANG/LC_MESSAGES) :
en résolution de locale POSIX/gettext, LC_ALL a priorité sur LC_MESSAGES et LANG — un ambiant
LC_ALL non forcé par la surcharge aurait laissé le marqueur se localiser malgré tout (bug
initialement introduit par la correction du finding B, qui ne forçait que LC_MESSAGES/LANG).

Crée une base jetable temporaire (préfixe lca_mes_test_rv_locale_), y provoque un conflit d'objet
minimal (table déjà présente) pour obtenir un vrai message "errors ignored on restore", puis
restaure deux fois par-dessus sous deux locales ambiantes différentes (français, anglais,
LC_ALL inclus) tout en appliquant la même surcharge que restore.ps1 : la ligne doit rester en
anglais dans les deux cas. Nettoie systématiquement la base créée et le fichier de dump temporaire,
y compris en cas d'échec (bloc finally).

Si aucune instance PostgreSQL n'est disponible, ce test s'auto-ignore (exit 0) plutôt que
d'échouer — cohérent avec le fait que scripts/tests/Test-BackupRotation.ps1 et
scripts/tests/Test-RestoreVerdict.ps1 (fonctions pures) restent, eux, exécutables sans PostgreSQL.

Exécution : powershell -File scripts/tests/Test-RestoreVerdictLocale.ps1
#>
[CmdletBinding()]
param(
    [string] $PgHost = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
    [int] $PgPort = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
    [string] $PgUser = $(if ($env:PGUSER) { $env:PGUSER } else { 'lca_mes' }),
    [string] $PgBinPath = 'C:\Program Files\PostgreSQL\18\bin'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\lib\ExternalTool.ps1')

$script:failureCount = 0
$script:testCount = 0

function Assert-True {
    param(
        [Parameter(Mandatory)][string] $Name,
        [bool] $Condition,
        [string] $Detail = ''
    )
    $script:testCount++
    if ($Condition) {
        Write-Host "  PASS - $Name"
    } else {
        $script:failureCount++
        Write-Host "  FAIL - $Name"
        if ($Detail) { Write-Host "    $Detail" }
    }
}

$psqlExe = Join-Path $PgBinPath 'psql.exe'
$pgDumpExe = Join-Path $PgBinPath 'pg_dump.exe'
$pgRestoreExe = Join-Path $PgBinPath 'pg_restore.exe'
$createdbExe = Join-Path $PgBinPath 'createdb.exe'
$dropdbExe = Join-Path $PgBinPath 'dropdb.exe'

Write-Host '=== Test-RestoreVerdictLocale : stabilité du marqueur pg_restore sous LC_ALL=C/LC_MESSAGES=C/LANG=C ==='

foreach ($exe in @($psqlExe, $pgDumpExe, $pgRestoreExe, $createdbExe, $dropdbExe)) {
    if (-not (Test-Path -LiteralPath $exe)) {
        Write-Host "Outil PostgreSQL introuvable : $exe — test auto-ignoré (aucune instance PostgreSQL disponible dans cet environnement)."
        exit 0
    }
}

$suffix = Get-Random -Maximum 999999
$dbName = "lca_mes_test_rv_locale_$suffix"
$dumpFile = Join-Path ([System.IO.Path]::GetTempPath()) "lca_mes_test_rv_locale_$suffix.dump"
$dbCreated = $false

try {
    Write-Host "Création de la base jetable '$dbName'..."
    $create = Invoke-ExternalTool -Path $createdbExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, $dbName)
    if ($create.ExitCode -ne 0) { throw "Échec de création de la base '$dbName' ($($create.Output -join ' '))" }
    $dbCreated = $true

    $createTable = Invoke-ExternalTool -Path $psqlExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-d', $dbName, '-c', 'CREATE TABLE probe (id int);')
    if ($createTable.ExitCode -ne 0) { throw "Échec de création de la table 'probe' ($($createTable.Output -join ' '))" }

    Write-Host "Dump de la base jetable vers $dumpFile..."
    $dump = Invoke-ExternalTool -Path $pgDumpExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-Fc', '-f', $dumpFile, $dbName)
    if ($dump.ExitCode -ne 0) { throw "Échec du dump ($($dump.Output -join ' '))" }

    # La table 'probe' existe déjà dans $dbName : restaurer ce même dump par-dessus provoque
    # systématiquement un conflit "la relation « probe » existe déjà" -> errors ignored on restore.
    foreach ($ambientLocale in @('fr_FR.UTF-8', 'en_US.UTF-8')) {
        $previousLcAll = [System.Environment]::GetEnvironmentVariable('LC_ALL')
        $previousLang = [System.Environment]::GetEnvironmentVariable('LANG')
        $previousLcMessages = [System.Environment]::GetEnvironmentVariable('LC_MESSAGES')
        # LC_ALL inclus dans l'ambiant simulé : c'est la variable de plus haute priorité en
        # résolution de locale POSIX/gettext, celle que la correction initiale du finding B avait
        # omis de forcer (finding IMPORTANT « LC_ALL », voir en-tête de fichier).
        [System.Environment]::SetEnvironmentVariable('LC_ALL', $ambientLocale)
        [System.Environment]::SetEnvironmentVariable('LANG', $ambientLocale)
        [System.Environment]::SetEnvironmentVariable('LC_MESSAGES', $ambientLocale)
        try {
            # Même surcharge que scripts/restore.ps1 : LC_ALL=C/LC_MESSAGES=C/LANG=C doit
            # l'emporter sur la locale ambiante ci-dessus, quelle qu'elle soit.
            $restoreResult = Invoke-ExternalTool -Path $pgRestoreExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-d', $dbName, $dumpFile) -EnvironmentOverrides @{ LC_ALL = 'C'; LC_MESSAGES = 'C'; LANG = 'C' }
        } finally {
            [System.Environment]::SetEnvironmentVariable('LC_ALL', $previousLcAll)
            [System.Environment]::SetEnvironmentVariable('LANG', $previousLang)
            [System.Environment]::SetEnvironmentVariable('LC_MESSAGES', $previousLcMessages)
        }
        $outputText = $restoreResult.Output -join [Environment]::NewLine
        Assert-True -Name "Marqueur anglais présent malgré une locale ambiante '$ambientLocale' (LC_ALL=C/LC_MESSAGES=C/LANG=C forcés pour l'appel)" `
            -Condition ($outputText -match 'errors ignored on restore:\s*\d+') `
            -Detail "Sortie réelle : $outputText"
    }
} catch {
    $script:failureCount++
    Write-Host "  FAIL - Exception pendant le test : $($_.Exception.Message)"
} finally {
    Write-Host 'Nettoyage...'
    if (Test-Path -LiteralPath $dumpFile) { Remove-Item -LiteralPath $dumpFile -Force }
    if ($dbCreated) {
        $drop = Invoke-ExternalTool -Path $dropdbExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '--if-exists', $dbName)
        if ($drop.ExitCode -ne 0) {
            Write-Host "  ATTENTION : échec du nettoyage de la base '$dbName' — suppression manuelle nécessaire : dropdb -h $PgHost -p $PgPort -U $PgUser $dbName"
        } else {
            Write-Host "Base jetable '$dbName' supprimée."
        }
    }
}

Write-Host ''
Write-Host '=== Résumé ==='
Write-Host "$($script:testCount) test(s), $($script:failureCount) échec(s)"

if ($script:failureCount -gt 0) {
    exit 1
}
exit 0
