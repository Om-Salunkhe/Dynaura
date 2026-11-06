# Running Dynaura on the Pi

Paths below assume user `pi` and the repo cloned to `/home/pi/Dynaura`. If yours differ, change
`User=` and the paths in the two `.service` files.

## 1. Python API

```bash
cd ~/Dynaura/pi
python3 -m venv --system-site-packages .venv   # system site-packages = the Pi's own GPIO libraries
.venv/bin/pip install -r requirements.txt
cp ../.env.example ../.env                      # then fill it in (never commit .env)
.venv/bin/python api.py                         # try it by hand first, Ctrl+C to stop
```

### Real hardware bring-up

Enable I2C on the Pi and install its inspection tools. The Python service venv uses the Pi's system GPIO/I2C packages:

```bash
sudo raspi-config nonint do_i2c 0
sudo apt-get update
sudo apt-get install -y i2c-tools python3-smbus python3-gpiozero
i2cdetect -y 1
```

The final building should answer at panel `0x45`, A `0x41`, B `0x44`, C `0x40`. Set these values and real mode in the repo-root `.env`:

```dotenv
DYNAURA_HW=real
INA_PANEL=0x45
INA_A=0x41
INA_B=0x44
INA_C=0x40
RELAY_ACTIVE_LOW=true
RELAY_A_GPIO=17
RELAY_B_GPIO=27
RELAY_C_GPIO=22
PUMP_GPIO=23
SHOP_DEMAND_WH=0
```

Run the safe bench check before starting the service:

```bash
cd ~/Dynaura/pi
.venv/bin/python -m hw.check_real
```

That command cycles each flat grid → solar → grid, never starts the pump, and safe-stops even on Ctrl+C. Use `--pump` only after putting the pump in water. A passing physical setup has the expected LEDs switching and more than 5 mA on the active load; merely printing all zeroes is not a pass.

## 2. Arkiv bridge (Node 22)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
cd ~/Dynaura/bridge && npm install && npm start  # Ctrl+C after you see the wallet line
```

## 3. Start both at boot

```bash
sudo cp ~/Dynaura/deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dynaura-bridge dynaura-api
journalctl -u dynaura-api -f          # live logs
```

## 4. Reach the Pi from the web app

The app on Vercel is served over https, so it can only call the Pi over https too.
Quickest way at the venue (the URL changes every time it starts):

```bash
cloudflared tunnel --url http://localhost:8000
```

Put the `https://….trycloudflare.com` address in Vercel as `VITE_API_URL` and redeploy.
On the same Wi-Fi without a tunnel, run the web app locally instead (`cd web && npm run dev`) with
`VITE_API_URL=http://<pi-ip>:8000`.

## 5. Run the laptop dev server against the Pi

An SSH tunnel avoids changing the frontend every time the Pi's LAN address changes:

```bash
# laptop terminal 1
ssh -N -L 8000:localhost:8000 dynaura@dynaura.local

# laptop terminal 2
cd ~/Dynaura/web
npm install
VITE_API_URL=http://localhost:8000 npm run dev -- --port 5181
```

Open:

- `http://localhost:5181/` — landing page
- `http://localhost:5181/home` — resident dashboard
- `http://localhost:5181/shop` — real shop marketplace
- `http://localhost:5181/admin/trading` — live committee market state

Sanity checks:

```bash
curl -s http://localhost:8000/api/health
curl -s http://localhost:8000/api/state
curl -s http://localhost:8000/api/marketplace
```

`/api/health` must report `"hw":"real"` before presenting sensor values as physical readings. `/api/marketplace` returns no offer until real measured spare has produced a successful 0G grid route; the UI deliberately does not invent one.
