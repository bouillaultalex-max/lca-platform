<#
Invoke-ExternalTool — invocation d'un exécutable externe (pg_dump, pg_restore, createdb,
dropdb, psql) compatible avec $ErrorActionPreference = 'Stop'.

Sous Windows PowerShell 5.1, fusionner stderr via `2>&1` sur une commande native alors que
$ErrorActionPreference = 'Stop' est actif transforme la moindre ligne stderr en exception
terminante — y compris quand le processus se termine réellement avec le code 0 — avant même la
lecture de $LASTEXITCODE (revue pr-review-toolkit ADM-11, finding BLOQUANT #1, vérifié
empiriquement). C'est particulièrement dangereux ici : pg_restore et pg_dump écrivent
couramment des avertissements bénins sur stderr sans que cela reflète un échec réel.

Cette fonction isole ce comportement : elle bascule $ErrorActionPreference sur 'Continue'
uniquement le temps de l'appel externe, capture stdout/stderr fusionnés, restaure la préférence
précédente, puis retourne le code retour réel et la sortie normalisée en texte simple. La
décision de succès/échec doit toujours être prise par l'appelant sur la seule base de
`.ExitCode`, jamais sur la présence de contenu dans `.Output`. Une exception PowerShell
authentique (ex. exécutable introuvable) continue de se propager normalement à l'appelant.

$EnvironmentOverrides (optionnel) : variables d'environnement positionnées uniquement le temps de
cet appel puis restaurées à leur valeur précédente (y compris absente), au même titre que
$ErrorActionPreference ci-dessus. Sert notamment à forcer LC_MESSAGES=C/LANG=C sur l'appel
pg_restore dont la sortie texte est analysée par scripts/lib/RestoreVerdict.ps1 (revue
pr-review-toolkit, finding IMPORTANT B, 2026-08-19) : sans cela, le message natif
« errors ignored on restore: N » est traduit selon la locale du compte exécutant le script
(ex. « erreurs ignorées lors de la restauration : N » en français), ce qui rendrait ce marqueur
indétectable sur un serveur non anglophone.
#>

function Invoke-ExternalTool {
    param(
        [Parameter(Mandatory)]
        [string] $Path,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]] $ArgumentList,

        [hashtable] $EnvironmentOverrides = @{}
    )
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $previousEnvValues = @{}
    foreach ($key in $EnvironmentOverrides.Keys) {
        $previousEnvValues[$key] = [System.Environment]::GetEnvironmentVariable($key)
        [System.Environment]::SetEnvironmentVariable($key, $EnvironmentOverrides[$key])
    }
    try {
        $rawOutput = & $Path @ArgumentList 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        foreach ($key in $EnvironmentOverrides.Keys) {
            [System.Environment]::SetEnvironmentVariable($key, $previousEnvValues[$key])
        }
        $ErrorActionPreference = $previousPreference
    }

    # Les lignes stderr capturées via 2>&1 arrivent comme des ErrorRecord PowerShell : on en
    # extrait uniquement le message utile (le texte réellement écrit par l'outil), sans le
    # formatage d'erreur PowerShell (pile d'appel, CategoryInfo) qui n'apporte rien dans un log
    # d'exploitation et gênerait la vérification "aucun secret dans les logs".
    $lines = @($rawOutput | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) {
            $_.Exception.Message
        } else {
            $_.ToString()
        }
    })

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $lines
    }
}
