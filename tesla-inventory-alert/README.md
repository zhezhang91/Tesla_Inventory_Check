# tesla-inventory-alert

Polls Tesla's inventory search for new Model 3 units within a radius of a
zip/postal code, and sends a desktop notification (`notify-send`) when new
units appear.

Tesla's inventory API is behind Akamai bot protection that requires passing a
JS challenge, so this drives real Chrome (via Playwright, using your system
Chrome install) to load the actual inventory page and captures the JSON it
fetches, rather than calling the API endpoint directly with plain HTTP.

## Setup

```sh
npm install
cp .env.example .env   # only needed if you want to change search params
```

Requires Google Chrome installed on the system (`which google-chrome`) —
Playwright drives it via `channel: 'chrome'` instead of downloading its own
Chromium.

`.env` (optional) — defaults are K4M 0K3, 500km radius, new Model 3:

- `ZIP`, `RANGE_KM`, `MODEL`, `CONDITION`

## Run once

```sh
npm start
```

First run sends a baseline notification listing everything currently in
inventory and records those VINs as "seen." Subsequent runs only notify when a
VIN appears that wasn't seen before. Every run also prints results to stdout.

## Schedule hourly via cron

```sh
crontab -e
```

Add:

```
0 * * * * cd /home/zjack/Desktop/Dev/tesla-inventory-alert && DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus /usr/bin/env node index.js >> run.log 2>&1
```

`notify-send` needs `DISPLAY` and `DBUS_SESSION_BUS_ADDRESS` set to reach your
desktop session from cron (cron jobs don't inherit your login session's
environment). Confirm the bus path with `echo $DBUS_SESSION_BUS_ADDRESS` while
logged into your desktop, and adjust the UID (`1000`) if needed
(`id -u`). Adjust the `node` path too if `which node` differs.

## Notes

- `seen.json` tracks which VINs have already triggered a notification. Delete
  it to reset and get a fresh baseline notification.
- If the page load times out or the inventory response never appears (e.g.
  Tesla changes their page, or a challenge isn't passed), a screenshot and
  HTML dump are written to `debug/failure.png` / `debug/failure.html` for
  troubleshooting.
