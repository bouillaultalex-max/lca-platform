# Fonctions pures (aucun accès disque ni réseau) pour le nommage et la rétention
# des sauvegardes PostgreSQL, conformément à docs/adr/0009-sauvegardes-automatiques-postgresql.md.
#
# Isolées ici pour rester testables sans Pester (absent du projet, non introduit pour ADM-11
# seul — voir ADR 0009, § Raisons du choix) : scripts/tests/Test-BackupRotation.ps1 dot-source
# ce fichier et vérifie ces fonctions par assertions manuelles.

Set-StrictMode -Version Latest

$script:BackupFilePattern = '^lca_mes_(?<date>\d{8})\.dump$'

function Get-BackupDateStamp {
    param(
        [Parameter(Mandatory)]
        [DateTime] $Date
    )
    return $Date.ToString('yyyyMMdd')
}

function Get-BackupFileName {
    param(
        [Parameter(Mandatory)]
        [string] $DateStamp
    )
    return "lca_mes_$DateStamp.dump"
}

function Get-BackupStagingFileName {
    param(
        [Parameter(Mandatory)]
        [string] $DateStamp
    )
    return "lca_mes_$DateStamp.staging.dump"
}

function ConvertFrom-BackupFileName {
    # Reconnaît uniquement le nommage attendu (lca_mes_YYYYMMDD.dump). Retourne $null pour
    # tout fichier qui ne correspond pas à cette convention (fichier étranger, staging, etc.)
    # plutôt que de lever une exception : la purge doit ignorer ces fichiers, jamais planter dessus.
    param(
        [Parameter(Mandatory)]
        [string] $FileName
    )
    $match = [regex]::Match($FileName, $script:BackupFilePattern)
    if (-not $match.Success) {
        return $null
    }
    $dateStamp = $match.Groups['date'].Value
    try {
        return [DateTime]::ParseExact($dateStamp, 'yyyyMMdd', [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return $null
    }
}

function Get-BackupFilesToPurge {
    <#
    Décision pure de rétention (ADR 0009, décision 5) : reçoit les dates des sauvegardes
    actuellement valides sur le disque (une par jour calendaire, déjà dédupliquées par le
    nommage lui-même) et retourne celles à purger.

    Conserve toujours les $RetentionCount dates les plus récentes, jamais moins — la
    sauvegarde la plus récente n'est donc jamais purgée, quelle que soit la valeur de
    RetentionCount, sans cas particulier séparé nécessaire.
    #>
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [DateTime[]] $ValidBackupDates,

        [Parameter(Mandatory)]
        [int] $RetentionCount
    )
    if ($RetentionCount -lt 1) {
        throw "RetentionCount doit être >= 1 (reçu : $RetentionCount)."
    }

    $sorted = @($ValidBackupDates | Sort-Object -Unique)
    if ($sorted.Count -le $RetentionCount) {
        return @()
    }

    $toKeep = @($sorted | Select-Object -Last $RetentionCount)
    $toPurge = @($sorted | Where-Object { $toKeep -notcontains $_ })
    return $toPurge
}

function Test-PathIsWithinDirectory {
    # Garde-fou avant toute suppression : refuse tout chemin qui ne se résout pas strictement
    # à l'intérieur du répertoire de sauvegarde attendu.
    param(
        [Parameter(Mandatory)]
        [string] $Path,

        [Parameter(Mandatory)]
        [string] $DirectoryPath
    )
    $resolvedDir = [System.IO.Path]::GetFullPath($DirectoryPath).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    return $resolvedPath.StartsWith($resolvedDir, [System.StringComparison]::OrdinalIgnoreCase)
}
