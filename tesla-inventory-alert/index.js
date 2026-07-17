import 'dotenv/config';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEN_FILE = path.join(__dirname, 'seen.json');

const {
  ZIP = 'K4M0K3',
  RANGE_KM = '500',
  MODEL = 'm3',
  CONDITION = 'new',
} = process.env;

// Tesla's inventory API sits behind Akamai bot protection that requires a real
// browser to pass a JS challenge before it'll serve inventory-results. So we
// drive the actual inventory page in Chrome and capture the JSON response it
// fetches, rather than calling the API endpoint directly.
async function fetchInventory() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ locale: 'en-CA' });
    const page = await context.newPage();

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/inventory/api/v1/inventory-results') && res.status() === 200,
      { timeout: 30000 }
    );

    const pageUrl = `https://www.tesla.com/en_ca/inventory/${CONDITION}/${MODEL}?zip=${ZIP}&range=${RANGE_KM}`;

    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const response = await responsePromise;
      const data = await response.json();
      return data.results ?? [];
    } catch (err) {
      const debugDir = path.join(__dirname, 'debug');
      await mkdir(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, 'failure.png'), fullPage: true }).catch(() => {});
      await writeFile(path.join(debugDir, 'failure.html'), await page.content().catch(() => ''));
      throw new Error(`Failed to load Tesla inventory page: ${err.message} (see debug/failure.png and debug/failure.html)`);
    }
  } finally {
    await browser.close();
  }
}

async function loadSeen() {
  if (!existsSync(SEEN_FILE)) return new Set();
  const raw = await readFile(SEEN_FILE, 'utf8');
  return new Set(JSON.parse(raw));
}

async function saveSeen(vins) {
  await writeFile(SEEN_FILE, JSON.stringify([...vins], null, 2));
}

function describeVehicle(v) {
  const price = v.InventoryPrice ?? v.TotalPrice ?? v.PurchasePrice ?? 'unknown price';
  const trim = v.TrimName ?? v.Trim ?? MODEL.toUpperCase();
  const paint = v.PAINT?.[0] ?? 'unknown color';
  const interior = v.INTERIOR?.[0] ?? 'unknown interior';
  const link = `https://www.tesla.com/${MODEL}/order/${v.VIN}`;
  return `${trim} — ${paint} / ${interior} — $${price} CAD\nVIN: ${v.VIN}\n${link}`;
}

async function sendAlert(subject, vehicles) {
  const body = vehicles.map(describeVehicle).join('\n\n');
  console.log(`${subject}\n\n${body}`);
  await execFileAsync('notify-send', ['--urgency=normal', '--app-name=Tesla Inventory', subject, body]);
}

async function run() {
  console.log(`[${new Date().toISOString()}] Checking Tesla inventory (${MODEL}, zip ${ZIP}, ${RANGE_KM}km)...`);

  const results = await fetchInventory();
  const seen = await loadSeen();
  const isFirstRun = seen.size === 0 && !existsSync(SEEN_FILE);

  const newVehicles = results.filter((v) => v.VIN && !seen.has(v.VIN));
  const currentVins = new Set(results.map((v) => v.VIN).filter(Boolean));

  if (isFirstRun) {
    console.log(`First run: seeding ${currentVins.size} known VINs and sending baseline summary.`);
    if (currentVins.size > 0) {
      await sendAlert(
        `Tesla inventory tracker started — ${currentVins.size} Model 3 unit(s) currently available`,
        results
      );
    }
    await saveSeen(currentVins);
    return;
  }

  if (newVehicles.length > 0) {
    console.log(`Found ${newVehicles.length} new vehicle(s). Sending alert.`);
    await sendAlert(
      `${newVehicles.length} new Tesla Model 3 unit(s) available near ${ZIP}`,
      newVehicles
    );
  } else {
    console.log('No new vehicles.');
  }

  await saveSeen(currentVins);
}

run().catch((err) => {
  console.error('Error running Tesla inventory check:', err);
  process.exit(1);
});
