TRUCKR CoWork (Chrome extension) — Fide Freight
================================================
One-click replies to drivers, dispatchers and carriers who email about the loads YOU posted on DAT One
and Truckstop, cross-checked with the loads YOU built in Salesforce. Each person's copy works from
their own sign-ins, so the details always match that person's loads.

INSTALL (3 minutes)
1. Unzip to a permanent local folder: Documents\TRUCKR CoWork (not Downloads). Don't move it later.
2. Chrome -> chrome://extensions -> turn on "Developer mode" (top right) -> "Load unpacked" -> pick that folder.
3. Pin it (puzzle-piece icon -> pin TRUCKR CoWork).
4. The Settings -> Accounts screen opens by itself:
   - Your name and email (filled in from Salesforce once you're signed in there).
   - DAT One: click "Sign in", sign in as YOU, come back. It shows "Signed in as <your name>".
   - Truckstop: same. Keep "Only loads I posted" on if your company shares one Truckstop account.
   - Salesforce: same.
   A yellow warning means that board is signed in as someone else: sign out there and sign in as you.

DAILY USE
- Open a carrier's email in Outlook on the web. The TRUCKR CoWork bar shows above it with the reply
  already written from your posted load:
    PU 11/14 06:00-14:00
    DEL 11/15 07:00-15:00
    Equipment - Reefer
    Temp - 34°F (continuous)
    Weight - 42,000 lbs
    Length - 53'
    Pallets - 22
    Commodity - Produce
    Rate - $4,200
    (accessorials: tarps, hazmat class / UN #, team, TWIC, drop trailer, appointment, FCFS, pallet exchange...)
- Click Reply. Outlook's reply opens with it typed in above your signature. Review and hit Send.
- Click the top of the bar to hide / show it. Keyboard: Alt+Shift+R (change it at chrome://extensions/shortcuts).
- Only on the carrier's FIRST email: once you (or anyone @ your company) answered in the thread, no bar.

WHAT IT RECOGNIZES
- Every trailer: Dry Van, Reefer, Van or Reefer, Flatbed, Step Deck, Flatbed or Step Deck, Double Drop,
  RGN / Lowboy, Conestoga, Hotshot, Power Only, Box Truck, Reefer Box Truck, Sprinter, Container, Tanker,
  Dump / Hopper, Auto Carrier (board names like "Reefer - R", codes like "SD", Salesforce names).
- Reefer temps (from DAT / Truckstop comments or Salesforce's temperature fields), continuous / cycle,
  frozen, pre-cool. Hazmat class and UN #. Pallets / pieces, dims, partials, team.
- Reference numbers: a carrier who writes "Load #131015", "Ref FF-88213" or "Load ID 1234" gets matched to
  that exact load, even with no lane in the email.
- Carriers' questions show as chips: temp, hazmat, team, pallets, appointment, live/drop, partial, rate, tarps.

WHERE THE DETAILS COME FROM (all read-only; it never posts or changes anything)
1. Your live posts on DAT One and Truckstop (your sign-ins).
2. Your Salesforce loads from the last few days (created by you, or you're the sales / client ops /
   carrier sales rep). Covered / cancelled in Salesforce -> "This one has been covered. Thank you!"
3. SPOTR CoWork, if you use it (optional): adds details from the customer's original email.
4. Loads you type into the bar yourself ("Enter details" / "Edit load"), kept 14 days.
Syncs on its own every minute while Outlook is open (a full DAT + Truckstop check every 10 minutes).

UPDATES (one click, from the cloud)
- When there's a new version, the popup says "TRUCKR CoWork vX is ready - Update now".
- Click it. The first time only, pick your Documents\TRUCKR CoWork folder and allow Chrome to edit it.
  It downloads the new version from GitHub, saves it into that folder and restarts. Settings and saved
  loads are kept. It never updates without your click.
- "Check for updates" also refreshes the reply rules from GitHub (no new version needed for those).
