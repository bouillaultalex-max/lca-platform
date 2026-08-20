#Requires -Version 5.1
<#
Sauvegarde automatique PostgreSQL — ADM-11, docs/adr/0009-sauvegardes-automatiques-postgresql.md.

Destiné à être déclenché quotidiennement par le Planificateur de tâches Windows (ADR 0009,
décision 1). Ne dépend d'aucun processus NestJS ni scheduler applicatif.

Identifiants PostgreSQL : jamais passés en argument de ce script ni sur la ligne de commande
pg_dump/pg_restore (ADR 0009, décision 9). Utiliser le mécanisme .pgpass du compte Windows qui
exécute la tâche planifiée (fichier %APPDATA%\postgresql\pgpass.conf), ou la variable
d'environnement PGPASSWORD positionnée uniquement dans le contexte de la tâche planifiée
elle-même — jamais commitée, jamais dans ce script.

Exemple d'appel (Planificateur de tâches Windows — -NonInteractive est important : sans lui,
un paramètre obligatoire manquant ferait attendre indéfiniment une saisie interactive
impossible dans le contexte d'une tâche planifiée, au lieu d'échouer immédiatement) :
  powershell.exe -NoProfile -NonInteractive -File "C:\chemin\vers\scripts\backup.ps1" `
    -PgDatabase "lca_mes" -BackupRoot "D:\Sauvegardes\lca_mes"

Voir scripts/README.md pour la procédure complète (installation, restauration, test mensuel).
#>
[CmdletBinding()]
param(
    [string] $PgHost = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
    [int] $PgPort = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
    [string] $PgUser = $(if ($env:PGUSER) { $env:PGUSER } else { 'lca_mes' }),

    # Nom de la base à sauvegarder. Aucune valeur par défaut : la base de production
    # (probablement "lca_mes", voir docker-compose.yml) doit être fournie explicitement au
    # moment du déploiement plutôt que supposée par ce script.
    [Parameter(Mandatory)]
    [string] $PgDatabase,

    # Répertoire racine des sauvegardes sur le disque local du serveur LCA (ADR 0009, décision 4).
    # Aucune valeur par défaut : le chemin réel du serveur n'est pas connu de ce dépôt.
    [Parameter(Mandatory)]
    [string] $BackupRoot,

    [ValidateRange(1, [int]::MaxValue)]
    [int] $RetentionCount = 30,

    [ValidateRange(0, [int]::MaxValue)]
    [int] $MinFreeSpaceMB = 1024,

    [string] $PgBinPath = 'C:\Program Files\PostgreSQL\18\bin'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BackupRotation.ps1')
. (Join-Path $PSScriptRoot 'lib\ExternalTool.ps1')

$stagingDir = Join-Path $BackupRoot 'staging'
$logFile = Join-Path $BackupRoot 'backup.log'

function Write-Log {
    param([string] $Level, [string] $Message)
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

function Exit-WithFailure {
    param([string] $Message)
    Write-Log -Level 'ERROR' -Message $Message
    exit 1
}

try {
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
} catch {
    # Le log lui-même vit dans $BackupRoot : s'il est inaccessible, on ne peut pas y écrire non
    # plus. On sort en écrivant l'erreur sur la sortie standard/erreur du Planificateur de tâches.
    Write-Error "Impossible de préparer les répertoires de sauvegarde ($BackupRoot) : $($_.Exception.Message)"
    exit 1
}

Write-Log -Level 'INFO' -Message "Démarrage du cycle de sauvegarde (base=$PgDatabase, host=$PgHost, port=$PgPort)."

# --- Vérification d'espace disque disponible (best effort : un échec de détection n'interrompt pas le cycle) ---
try {
    $rootFull = [System.IO.Path]::GetFullPath($BackupRoot)
    $driveName = ([System.IO.Path]::GetPathRoot($rootFull)).TrimEnd('\').TrimEnd(':')
    $drive = Get-PSDrive -Name $driveName -ErrorAction Stop
    $freeMB = [Math]::Floor($drive.Free / 1MB)
    if ($freeMB -lt $MinFreeSpaceMB) {
        Exit-WithFailure "Espace disque insuffisant sur le lecteur ${driveName}: (${freeMB} Mo libres, minimum requis ${MinFreeSpaceMB} Mo). Sauvegarde abandonnée avant tout pg_dump."
    }
    Write-Log -Level 'INFO' -Message "Espace disque disponible sur ${driveName}: ${freeMB} Mo."
} catch {
    Write-Log -Level 'WARN' -Message "Impossible de vérifier l'espace disque disponible ($($_.Exception.Message)) — poursuite du cycle sans cette vérification préalable."
}

$dateStamp = Get-BackupDateStamp -Date (Get-Date)
$finalFileName = Get-BackupFileName -DateStamp $dateStamp
$stagingFileName = Get-BackupStagingFileName -DateStamp $dateStamp
$stagingFilePath = Join-Path $stagingDir $stagingFileName
$finalFilePath = Join-Path $BackupRoot $finalFileName

# Une exécution précédente le même jour a pu laisser un fichier de staging partiel : il n'a
# jamais été promu (le déplacement n'intervient qu'après validation complète), donc son retrait
# est sûr avant de repartir d'un pg_dump propre (ADR 0009, décision 5).
if (Test-Path -LiteralPath $stagingFilePath) {
    Remove-Item -LiteralPath $stagingFilePath -Force
    Write-Log -Level 'INFO' -Message "Fichier de staging résiduel d'une exécution précédente supprimé : $stagingFileName"
}

# --- pg_dump vers le staging ---
$pgDumpExe = Join-Path $PgBinPath 'pg_dump.exe'
if (-not (Test-Path -LiteralPath $pgDumpExe)) {
    Exit-WithFailure "pg_dump introuvable à l'emplacement attendu : $pgDumpExe"
}

Write-Log -Level 'INFO' -Message "Exécution de pg_dump -Fc vers le staging : $stagingFilePath"
$pgDumpResult = Invoke-ExternalTool -Path $pgDumpExe -ArgumentList @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-Fc', '-f', $stagingFilePath, $PgDatabase)
if ($pgDumpResult.Output) {
    # Une sortie stderr (ex. avertissement de version) est journalisée mais ne détermine jamais
    # à elle seule le succès/échec — seul $pgDumpResult.ExitCode (= $LASTEXITCODE réel) le fait.
    Add-Content -Path $logFile -Value ($pgDumpResult.Output -join [Environment]::NewLine)
}
if ($pgDumpResult.ExitCode -ne 0) {
    Exit-WithFailure "pg_dump a échoué (code retour $($pgDumpResult.ExitCode)). Détail dans $logFile. Aucune purge."
}
if (-not (Test-Path -LiteralPath $stagingFilePath) -or (Get-Item -LiteralPath $stagingFilePath).Length -eq 0) {
    # Un code retour 0 seul n'est jamais une preuve suffisante (ADR 0009, décision 6).
    Exit-WithFailure "pg_dump a retourné le code 0 mais le fichier de staging est absent ou vide ($stagingFilePath). Aucune purge."
}
Write-Log -Level 'INFO' -Message 'pg_dump terminé, fichier de staging non vide produit.'

# --- Vérification structurelle légère : pg_restore --list (ADR 0009, décision 6) ---
$pgRestoreExe = Join-Path $PgBinPath 'pg_restore.exe'
if (-not (Test-Path -LiteralPath $pgRestoreExe)) {
    Exit-WithFailure "pg_restore introuvable à l'emplacement attendu : $pgRestoreExe"
}

Write-Log -Level 'INFO' -Message 'Vérification structurelle du fichier de staging (pg_restore --list).'
$restoreListResult = Invoke-ExternalTool -Path $pgRestoreExe -ArgumentList @('--list', $stagingFilePath)
if ($restoreListResult.ExitCode -ne 0) {
    if ($restoreListResult.Output) {
        Add-Content -Path $logFile -Value ($restoreListResult.Output -join [Environment]::NewLine)
    }
    Exit-WithFailure "pg_restore --list a échoué sur le fichier de staging (code retour $($restoreListResult.ExitCode)) : sauvegarde considérée corrompue, non promue, aucune purge."
}
Write-Log -Level 'INFO' -Message 'Vérification structurelle réussie.'

# --- Déplacement vers la destination finale — uniquement après validation complète (ADR 0009, décision 5) ---
try {
    Move-Item -LiteralPath $stagingFilePath -Destination $finalFilePath -Force
} catch {
    Exit-WithFailure "Échec du déplacement du staging vers le répertoire final ($finalFilePath) : $($_.Exception.Message). Fichier de staging conservé pour analyse : $stagingFilePath. Aucune purge."
}
Write-Log -Level 'INFO' -Message "Sauvegarde du jour installée : $finalFileName"

# --- Rotation / purge — uniquement après un cycle complet réussi (ADR 0009, décisions 5 et 7) ---
# Un échec de purge (fichier verrouillé, etc.) ne remet jamais en cause la sauvegarde du jour
# déjà acquise plus haut. Mais un échec partiel de purge n'est pas non plus un succès plein :
# le cycle se termine alors en échec (code retour non nul) pour rester visible via le seul
# mécanisme de détection existant (code retour du Planificateur de tâches, ADR 0009 décision 8),
# tout en continuant à purger les fichiers suivants plutôt que d'abandonner sur le premier échec.
$purgeFailureCount = 0
try {
    $existingFiles = @(Get-ChildItem -LiteralPath $BackupRoot -Filter 'lca_mes_*.dump' -File)
    $validDates = @()
    foreach ($file in $existingFiles) {
        $parsedDate = ConvertFrom-BackupFileName -FileName $file.Name
        if ($null -ne $parsedDate) {
            $validDates += $parsedDate
        }
    }

    $toPurge = @(Get-BackupFilesToPurge -ValidBackupDates $validDates -RetentionCount $RetentionCount)
    if ($toPurge.Count -eq 0) {
        Write-Log -Level 'INFO' -Message "Aucune purge nécessaire ($($validDates.Count) sauvegarde(s) valide(s), rétention $RetentionCount)."
    } else {
        $purgedCount = 0
        foreach ($purgeDate in $toPurge) {
            $purgeFileName = Get-BackupFileName -DateStamp (Get-BackupDateStamp -Date $purgeDate)
            $purgeFilePath = Join-Path $BackupRoot $purgeFileName
            if (-not (Test-PathIsWithinDirectory -Path $purgeFilePath -DirectoryPath $BackupRoot)) {
                # Garde-fou défensif : ne devrait jamais se produire (le nom est reconstruit à
                # partir de $BackupRoot lui-même), mais la suppression reste strictement bornée
                # au répertoire de sauvegarde prévu, jamais à un chemin dérivé sans vérification.
                Write-Log -Level 'WARN' -Message "Purge ignorée : chemin hors du répertoire de sauvegarde attendu ($purgeFilePath)."
                $purgeFailureCount++
                continue
            }
            try {
                Remove-Item -LiteralPath $purgeFilePath -Force
                $purgedCount++
                Write-Log -Level 'INFO' -Message "Sauvegarde purgée (rétention de $RetentionCount dépassée) : $purgeFileName"
            } catch {
                # Échec limité à ce seul fichier : on continue avec les suivants plutôt que
                # d'abandonner toute la purge sur un unique fichier verrouillé.
                $purgeFailureCount++
                Write-Log -Level 'WARN' -Message "Échec de la suppression de $purgeFileName : $($_.Exception.Message). Poursuite avec les fichiers suivants."
            }
        }
        Write-Log -Level 'INFO' -Message "Purge terminée : $purgedCount/$($toPurge.Count) sauvegarde(s) supprimée(s), $purgeFailureCount échec(s)."
    }
} catch {
    # Échec inattendu avant même la boucle (ex. Get-ChildItem/Get-BackupFilesToPurge) : la
    # sauvegarde du jour reste acquise, mais la purge n'a pas pu être évaluée.
    $purgeFailureCount++
    Write-Log -Level 'WARN' -Message "Échec de l'évaluation de la purge des anciennes sauvegardes : $($_.Exception.Message). La sauvegarde du jour reste acquise, intervention manuelle possible."
}

if ($purgeFailureCount -gt 0) {
    Write-Log -Level 'ERROR' -Message "Cycle de sauvegarde terminé avec la sauvegarde du jour acquise, mais $purgeFailureCount échec(s) de purge à traiter manuellement."
    exit 1
}

Write-Log -Level 'INFO' -Message 'Cycle de sauvegarde terminé avec succès.'
exit 0
