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
