[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageName = "@fa_yoshinobu/node-red-contrib-plc-comm-slmp"
$workRoot = Join-Path $repositoryRoot ("build/package-contract-" + [guid]::NewGuid().ToString("N"))
$packRoot = Join-Path $workRoot "pack"
$consumerRoot = Join-Path $workRoot "consumer"

function Test-RepositoryOnlyPath {
    param([Parameter(Mandatory)][string]$Path)

    $normalized = $Path.Replace("\", "/")
    $leafName = [System.IO.Path]::GetFileName($normalized)
    $rootOnlyFiles = @(
        ".gitattributes",
        ".gitignore",
        ".npmrc",
        ".pypirc",
        "AGENTS.md",
        "CODE_OF_CONDUCT.md",
        "CONTRIBUTING.md",
        "SECURITY.md",
        "SUPPORT.md",
        "TODO.md",
        "release_check.bat",
        "run_ci.bat"
    )

    return (
        $normalized -in $rootOnlyFiles -or
        $normalized -match '^(test|tests|\.github|\.codex|docsrc|internal_docs|scripts|tools|build|build_win|dist|out|release|releases|release-artifacts)/' -or
        $normalized -match '(^|/)(node_modules|coverage|\.nyc_output|\.cache|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)(/|$)' -or
        $leafName -match '^(\.coverage(?:\..+)?|coverage-final\.json|lcov\.info)$' -or
        $leafName -match '^(\.env(?:\..+)?|\.npmrc|\.pypirc|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|credentials?(?:\..+)?|secrets?(?:\..+)?)$' -or
        $leafName -match '\.(pem|key|pfx|p12|jks|keystore)$'
    )
}

$guardContractForbidden = @(
    "AGENTS.md",
    "scripts/release.ps1",
    ".github/workflows/ci.yml",
    "build/package.tgz",
    "release-artifacts/package.tgz",
    "nested/.env.production",
    "nested/private-key.pem",
    "nested/.cache/state.json",
    "coverage/lcov.info"
)
$guardContractAllowed = @(
    "LICENSE",
    "README.md",
    "package.json",
    "lib/index.js",
    "examples/flows/README.md",
    "examples/flows/slmp-basic-read-write.json"
)
$guardMisses = @($guardContractForbidden | Where-Object { -not (Test-RepositoryOnlyPath -Path $_) })
$guardFalsePositives = @($guardContractAllowed | Where-Object { Test-RepositoryOnlyPath -Path $_ })
if ($guardMisses.Count -ne 0 -or $guardFalsePositives.Count -ne 0) {
    throw "Repository-only path guard contract failed: misses=$($guardMisses -join ', ') false-positives=$($guardFalsePositives -join ', ')"
}

try {
    [void](New-Item -ItemType Directory -Path $packRoot -Force)
    [void](New-Item -ItemType Directory -Path $consumerRoot -Force)

    Push-Location $repositoryRoot
    try {
        $json = (& npm pack --json --pack-destination $packRoot | Out-String)
        if ($LASTEXITCODE -ne 0) { throw "npm pack --json failed." }
        $result = @($json | ConvertFrom-Json)
    }
    finally {
        Pop-Location
    }
    if ($result.Count -ne 1) { throw "Expected exactly one npm pack result; found $($result.Count)." }

    $files = @($result[0].files | ForEach-Object { $_.path.Replace("\", "/") } | Sort-Object -Unique)
    $forbidden = @($files | Where-Object { Test-RepositoryOnlyPath -Path $_ })
    if ($forbidden.Count -ne 0) {
        throw "npm package contains repository-only files: $($forbidden -join ', ')"
    }
    $required = @(
        "LICENSE",
        "README.md",
        "package.json",
        "lib/index.js",
        "examples/flows/README.md",
        "examples/flows/slmp-basic-read-write.json"
    )
    $missing = @($required | Where-Object { $_ -notin $files })
    if ($missing.Count -ne 0) { throw "npm package is missing required files: $($missing -join ', ')" }

    $manifest = Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
    if ($manifest.name -ne $packageName) { throw "Unexpected npm package name: $($manifest.name)" }
    $forbiddenScripts = @(@("test", "check", "smoke:editor") | Where-Object {
        $null -ne $manifest.scripts -and $null -ne $manifest.scripts.PSObject.Properties[$_]
    })
    if ($forbiddenScripts.Count -ne 0) {
        throw "npm manifest advertises excluded developer commands: $($forbiddenScripts -join ', ')"
    }

    $tarballPath = Join-Path $packRoot ([string]$result[0].filename)
    if (-not (Test-Path -LiteralPath $tarballPath -PathType Leaf)) {
        throw "npm pack did not create the reported tarball: $tarballPath"
    }

    Push-Location $consumerRoot
    try {
        & npm init --yes --silent *> $null
        if ($LASTEXITCODE -ne 0) { throw "npm init failed for the isolated consumer." }
        & npm install --ignore-scripts --no-audit --no-fund --no-package-lock --silent $tarballPath
        if ($LASTEXITCODE -ne 0) { throw "npm tarball install failed for the isolated consumer." }

        $smoke = @'
const assert = require("node:assert/strict");
const path = require("node:path");
const slmp = require("@fa_yoshinobu/node-red-contrib-plc-comm-slmp");
const installedRoot = path.join(process.cwd(), "node_modules", "@fa_yoshinobu", "node-red-contrib-plc-comm-slmp");
assert.ok(require.resolve("@fa_yoshinobu/node-red-contrib-plc-comm-slmp").startsWith(installedRoot));
assert.equal(typeof slmp.SlmpClient, "function");
assert.equal(typeof slmp.writeBitInWord, "function");
for (const name of [
  "plcProfileDisplayName",
  "readDWordsSingleRequest",
  "readFloat32s",
  "readLongTimer",
  "readLongRetentiveTimer",
]) {
  assert.equal(typeof slmp[name], "function", name);
}
const addressOptions = { plcProfile: "melsec:iq-r" };
for (const text of ["D100", "X10"]) {
  const device = slmp.parseDevice(text, addressOptions);
  assert.equal(slmp.deviceToString(device, addressOptions), text);
}
assert.equal(
  slmp.formatParsedAddress(slmp.parseAddress("d100:u"), addressOptions),
  "D100:U",
);
assert.equal(slmp.normalizeAddress("d50.a", addressOptions), "D50.A");
for (const name of [
  "readWordsExtended",
  "writeWordsExtended",
  "readBitsExtended",
  "writeBitsExtended",
  "readRandomExtended",
  "registerMonitorDevicesExtended",
  "writeRandomWordsExtended",
  "writeRandomBitsExtended",
  "readLatestSelfDiagnosisErrorCode",
  "readRandomExt",
  "registerMonitorDevicesExt",
  "writeRandomWordsExt",
  "writeRandomBitsExt",
]) {
  assert.equal(typeof slmp.SlmpClient.prototype[name], "function", name);
}
for (const name of [
  "memoryReadWords",
  "memoryWriteWords",
  "extendUnitReadBytes",
  "extendUnitReadWords",
  "extendUnitWriteBytes",
  "extendUnitWriteWords",
]) {
  assert.equal(slmp.SlmpClient.prototype[name], undefined, name);
}
for (const name of [
  "DeviceAddress",
  "AddressSpec",
  "parseDeviceAddress",
  "formatDeviceAddress",
  "normalizeDeviceAddress",
  "parseAddressSpec",
  "formatAddressSpec",
  "normalizeAddressSpec",
]) {
  assert.equal(slmp[name], undefined, name);
}
const installedManifest = require(path.join(installedRoot, "package.json"));
assert.deepEqual(Object.keys(installedManifest["node-red"].nodes).sort(), [
  "slmp-connection",
  "slmp-read",
  "slmp-write",
]);
const target = { network: 0, station: 0xff, moduleIO: 0x03ff, multidrop: 0 };
const client = new slmp.SlmpClient({
  host: "127.0.0.1",
  port: 1025,
  transport: "tcp",
  plcProfile: "melsec:iq-r",
  target,
});
const commands = [];
client._requestInternal = async (command) => {
  commands.push(command);
  return command === slmp.Command.DEVICE_READ
    ? { endCode: 0, data: Buffer.from([0, 0]) }
    : { endCode: 0, data: Buffer.alloc(0) };
};
(async () => {
  const rmw = slmp.writeBitInWord(client, "D0", 3, true);
  const later = client.rawCommand(slmp.Command.SELF_TEST, {
    subcommand: 0,
    payload: Buffer.alloc(0),
  });
  await Promise.all([rmw, later]);
  assert.deepEqual(commands, [
    slmp.Command.DEVICE_READ,
    slmp.Command.DEVICE_WRITE,
    slmp.Command.SELF_TEST,
  ]);
  console.log("[OK] installed npm consumer assertions reached");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
'@
        $smokePath = Join-Path $consumerRoot "installed-consumer-smoke.js"
        [System.IO.File]::WriteAllText(
            $smokePath,
            $smoke,
            [System.Text.UTF8Encoding]::new($false)
        )
        & node $smokePath
        if ($LASTEXITCODE -ne 0) { throw "installed npm consumer import/RMW smoke failed." }
    }
    finally {
        Pop-Location
    }

    $installedPackageRoot = Join-Path $consumerRoot "node_modules/@fa_yoshinobu/node-red-contrib-plc-comm-slmp"
    $installedManifest = Get-Content -LiteralPath (Join-Path $installedPackageRoot "package.json") -Raw | ConvertFrom-Json
    if ($installedManifest.name -ne $packageName) {
        throw "Installed package-name import contract is wrong: $($installedManifest.name)"
    }
    $flowFiles = @(Get-ChildItem -LiteralPath (Join-Path $installedPackageRoot "examples/flows") -Filter "*.json" -File)
    if ($flowFiles.Count -eq 0) { throw "Installed npm package has no importable Node-RED example flows." }
    foreach ($flow in $flowFiles) {
        Get-Content -LiteralPath $flow.FullName -Raw | ConvertFrom-Json *> $null
    }

    Write-Host "[OK] npm tarball consumer passed: files=$($files.Count) flows=$($flowFiles.Count)"
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
}
