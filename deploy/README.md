# Going live on a VPS

You need **no domain and no app name** to start testing. The setup script gives the server a free HTTPS address made from its IP, e.g. `https://203-0-113-7.sslip.io`. Camera and mic work on it, so it's good for real testing on phones.

## 1. Buy the VPS

- **Type:** a plain Linux VPS (for example a Hostinger KVM plan), not web/WordPress hosting.
- **Size:** about 2 vCPU / 4–8 GB RAM is plenty for testing and an early launch.
- **Operating system:** **Ubuntu 24.04** (or 22.04), plain OS with no control panel.
- **Location:** an India data centre if offered, for lower call latency.
- **Access:** set a root password or add your SSH key when asked.
- **Note:** the server's **IP address**, shown in the VPS dashboard.

## 2. Open a terminal on the VPS

Use the provider's **browser terminal** (in hPanel: VPS → *Browser terminal*), or from your computer:

```bash
ssh root@YOUR_SERVER_IP
```

## 3. Install the app (one command)

Replace the email with your own; that account becomes the admin when it signs up.

```bash
curl -fsSL https://raw.githubusercontent.com/srisomesh-ai/datingapp/main/deploy/setup.sh -o setup.sh
sudo bash setup.sh --admin-email you@example.com
```

It takes about 5 minutes. It installs and configures:

- Node.js 22, and the app as a service that restarts on reboot or crash
- **Caddy** for HTTPS, with free certificates that renew automatically
- **coturn**, a TURN relay so voice/video calls connect on mobile data and strict Wi-Fi
- the firewall, and daily database backups in `/var/backups/datingapp`

At the end it prints your address, e.g. `https://203-0-113-7.sslip.io`.

> **Provider firewall:** if your VPS dashboard has its own firewall, allow
> **TCP 80, 443, 3478**, **UDP 443, 3478** and **UDP 49152–65535**.
> Otherwise HTTPS or calls won't work.

## 4. Test it

Open the address on two phones, ideally **one on Wi-Fi and one on mobile data**, so calls are tested through the relay. Sign up first with your admin email.

Checklist:

- [ ] Sign up, add a photo, hobbies and likes
- [ ] Discover: guess a name, get +1 🪙, send a like with a message
- [ ] The other phone sees it under **Chats → Likes you** and likes back, then you chat
- [ ] Free voice + video call between the match
- [ ] Profile → turn on **Friend mode** and go available, then from the other phone call them in **Find a Friend**: per-minute billing and earnings
- [ ] 🪙 10 sample call. Guess 10 names, or give yourself test coins on the server:
      `sudo sqlite3 /var/lib/datingapp/app.db "UPDATE users SET coins = coins + 20 WHERE email = 'you@example.com'"`
- [ ] Wallet: add money, buy a package, request a withdrawal, then approve it on the **Admin** page

### Payments while testing

Without Razorpay keys the app runs in **mock mode**: "Pay" adds money instantly for free. To test real payment screens without real money, use **Razorpay test mode**:

1. Sign up at dashboard.razorpay.com. Test mode works before KYC.
2. Switch to **Test mode**, go to Account & Settings → **API Keys**, and generate a key (`rzp_test_…` + secret).
3. Re-run the setup with the keys:

   ```bash
   sudo bash /opt/datingapp/deploy/setup.sh --razorpay-key-id rzp_test_xxx --razorpay-key-secret yyy
   ```

4. Pay with Razorpay's test UPI ID / test cards, which are listed in their docs.

For real money later, complete Razorpay KYC and re-run with the `rzp_live_…` keys.

## 5. Updating after code changes

After changes are merged into `main` on GitHub:

```bash
sudo bash /opt/datingapp/deploy/setup.sh
```

It pulls the latest code, rebuilds and restarts. Users, photos, wallet balances and secrets are kept.

## 6. Later: your own domain and name

1. Buy the domain and add an **A record** pointing to the VPS IP.
2. Re-run: `sudo bash /opt/datingapp/deploy/setup.sh --domain yourapp.com`
3. Change the app name in `client/src/lib/api.js` (`APP_NAME`), `client/index.html` and `client/public/manifest.webmanifest`, merge, then run the update.

Accounts and data move over automatically. Users need to log in again on the new address.

## Troubleshooting

| Problem | Check |
|---|---|
| Site doesn't open / no HTTPS | `journalctl -u caddy -n 50`, and that ports 80/443 are open in the provider firewall |
| App error | `journalctl -u datingapp -f` |
| Calls ring but never connect | Provider firewall must allow UDP 3478 and UDP 49152–65535; `journalctl -u coturn -n 50` |
| Restart everything | `sudo systemctl restart datingapp caddy coturn` |
| Settings | `/etc/datingapp.env` (re-run the setup script after editing) |
| Restore a backup | `sudo systemctl stop datingapp && sudo cp /var/backups/datingapp/app-DATE.db /var/lib/datingapp/app.db && sudo chown datingapp: /var/lib/datingapp/app.db && sudo systemctl start datingapp` |
