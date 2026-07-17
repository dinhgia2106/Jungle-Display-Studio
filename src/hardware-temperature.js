const fs = require('fs');
const path = require('path');

function normalizeTemperature(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!text) return null;
  const temperature = Number(text);
  return Number.isFinite(temperature) && temperature >= -20 && temperature <= 150
    ? Math.round(temperature * 10) / 10
    : null;
}

function parseTemperatureOutput(output) {
  for (const line of String(output || '').split(/\r?\n/)) {
    const temperature = normalizeTemperature(line);
    if (temperature !== null) return temperature;
  }
  return null;
}

function windowsSensorScript(device) {
  const cpu = device === 'cpu';
  const pattern = cpu
    ? 'CPU Package|CPU Core|CPU CCD|Tctl|Tdie'
    : 'GPU Core|GPU Temperature|GPU Hot Spot';
  const preferred = cpu ? 'CPU Package|Tctl|Tdie' : 'GPU Core|GPU Temperature';
  const acpiFallback = cpu ? `
$counterValues = @()
foreach ($path in @('\\Thermal Zone Information(*)\\High Precision Temperature', '\\Thermal Zone Information(*)\\Temperature')) {
  $counterValues += @(Get-Counter $path | Select-Object -ExpandProperty CounterSamples | Select-Object -ExpandProperty CookedValue)
}
$values = @($counterValues | ForEach-Object {
  if ($_ -gt 1000) { ([double]$_ / 10) - 273.15 }
  elseif ($_ -gt 200) { [double]$_ - 273.15 }
  else { [double]$_ }
} | Where-Object { $_ -ge -20 -and $_ -le 150 })
if ($values.Count -gt 0) {
  $value = ($values | Measure-Object -Maximum).Maximum
  [Console]::WriteLine(([double]$value).ToString([Globalization.CultureInfo]::InvariantCulture))
  exit
}
$zones = Get-CimInstance -Namespace 'root/wmi' -ClassName 'MSAcpi_ThermalZoneTemperature'
$values = @($zones | ForEach-Object { ([double]$_.CurrentTemperature / 10) - 273.15 } | Where-Object { $_ -ge -20 -and $_ -le 150 })
if ($values.Count -gt 0) {
  $value = ($values | Measure-Object -Maximum).Maximum
  [Console]::WriteLine(([double]$value).ToString([Globalization.CultureInfo]::InvariantCulture))
}` : '';

  return `$ErrorActionPreference = 'SilentlyContinue'
foreach ($namespace in @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')) {
  $sensors = @(Get-CimInstance -Namespace $namespace -ClassName 'Sensor' | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match '${pattern}' })
  if ($sensors.Count -eq 0) { continue }
  $preferred = @($sensors | Where-Object { $_.Name -match '${preferred}' })
  if ($preferred.Count -eq 0) { $preferred = $sensors }
  $value = ($preferred.Value | Measure-Object -Maximum).Maximum
  if ($null -ne $value) {
    [Console]::WriteLine(([double]$value).ToString([Globalization.CultureInfo]::InvariantCulture))
    exit
  }
}${acpiFallback}`;
}

async function sampleWindowsTemperature(device, execFileAsync) {
  try {
    const result = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', windowsSensorScript(device)
    ], { timeout: 3000, windowsHide: true });
    return parseTemperatureOutput(result.stdout);
  } catch {
    return null;
  }
}

function readLinuxTemperature(device) {
  const roots = device === 'cpu' ? ['/sys/class/thermal'] : ['/sys/class/drm'];
  const candidates = [];

  function visit(folder, depth = 0) {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) visit(entryPath, depth + 1);
      if (!/^temp\d+_input$/.test(entry.name) && entry.name !== 'temp') continue;
      try {
        const raw = Number(fs.readFileSync(entryPath, 'utf8').trim());
        const temperature = normalizeTemperature(Math.abs(raw) > 1000 ? raw / 1000 : raw);
        if (temperature !== null) candidates.push(temperature);
      } catch {
        // A sensor can disappear while hardware is being unplugged.
      }
    }
  }

  roots.forEach((root) => visit(root));
  return candidates.length ? Math.max(...candidates) : null;
}

async function sampleTemperature(device, execFileAsync, platform = process.platform) {
  if (platform === 'win32') return sampleWindowsTemperature(device, execFileAsync);
  if (platform === 'linux') return readLinuxTemperature(device);
  return null;
}

module.exports = {
  normalizeTemperature,
  parseTemperatureOutput,
  windowsSensorScript,
  sampleTemperature
};
