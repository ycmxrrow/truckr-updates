TRUCKR — by Collin Morrow (Chrome extension)
=============================================
One-click replies to truck drivers, dispatchers and carriers who email about loads you posted on DAT and Truckstop.

INSTALL (1 minute)
1. The TRUCKR folder lives in Documents\TRUCKR. Don't move or delete it.
2. chrome://extensions → Developer mode ON → "Load unpacked" → pick Documents\TRUCKR.
3. Pin it (puzzle-piece icon → pin TRUCKR).
4. SPOTR must be on, version 1.37.5 or newer (click "Check for updates" in SPOTR once).
   TRUCKR gets your loads through SPOTR, so it uses the same DAT + Truckstop sign-ins. No extra logins.

DAILY USE
- Open a carrier's email in Outlook on the web. A TRUCKR bar shows above it:
    [DAT inquiry] [Winchester, VA → Mechanicsville, VA] [11/17] [MC 1591884] [offer $800]
  with the reply already written from your posted load:
    Hi there,

    PU 07:00-15:00
    DEL 07:00-15:00
    Weight - 43,500 lbs
    Length - 53'
    Commodity - Pet Feed
    Rate - $850
    (accessorials: Tarps required, Coil racks required, Edge protectors required...)
- Click Reply. Outlook's reply opens with it typed in above your signature. Review and hit Send.
- Keyboard: Alt+Shift+T replies to the carrier email on screen (change it at chrome://extensions/shortcuts).
- You can type over the reply in the box before clicking Reply.

WHERE THE LOAD DETAILS COME FROM
1. SPOTR's own record of every load it posted (the customer's email: hours, weight, length, commodity,
   posted rate, tarps / coil racks / edge protectors, multi-stops).
2. Your live posts on DAT One and Truckstop right now (through SPOTR's sign-in), so loads you posted by hand
   are covered too, and loads that come down (covered) drop out.
3. Salesforce: every load you built in the last few days (created by you, or you're the sales / client ops /
   carrier sales rep), read with your normal Salesforce sign-in. Keep a Salesforce tab signed in.
4. Loads you typed into the bar yourself ("Enter details"), kept 14 days.

SALESFORCE CROSS-CHECK
- Each post is matched to its Salesforce load (same pickup, and the delivery or any drop matches, within 3 days).
  The bar shows the load number (click it to open Salesforce), its status and max pay (max pay is never put in a reply).
- Covered / dispatched / cancelled in Salesforce: the bar says so and the reply becomes
  "This one has been covered. Thank you!" It also tells you the post should come down.
- Anything that differs between the post and Salesforce is flagged (weight, rate, pickup date, stops, length,
  equipment, PU hours). "Use Salesforce details" rewrites the reply from Salesforce.
- Salesforce has more stops than the post (e.g. Peotone > Morton > Arthur): the reply lists every stop.
- Loads in Salesforce that aren't on the boards or in SPOTR are answered from Salesforce.
- Loads posted but not built in Salesforce yet show "not built in Salesforce yet".
Hours follow the board the carrier saw: a Truckstop inquiry gets your Truckstop hours, DAT gets DAT hours.

CARRIER EMAILS TRUCKR READS (from your Carriers folder)
- DAT One: "Winchester, VA to Mechanicsville, VA for 11/17" + "Pick Up / Drop Off / Trip Miles / From load posted on DAT"
- Truckstop Go App: "Inquiry about load: Peotone, IL --> Morton, IL by Wed 11/11 on Truckstop Go App" (Origin / Destination / Posted rate)
- Loadlink: "I saw your load posted on Loadlink from Lomira, WI to Milton, ON"
- Plain subjects: "Peotone, IL Morton, IL", "Mobile, AL - Brewton, AL", "Brewster, NY (49) Hubbard, OH",
  "661 mi Gary , IN King , NC 11/12", "[LOAD] - Brewster NY to Hubbard OH", "Load from Masury, OH to Elkhart, IN",
  "527 Troutdale, OR Oroville, CA 11/2 Flatbed Hotshot 12000 14", even "TROUTDALE TO OROVILLE" or "OR to CA".
- It also shows the MC #, any offer ("$800", "I can take it for posted rate") and questions (straight thru? rate?).
- Source: named in the email when it says (DAT / Truckstop / Loadlink). Otherwise from the load: dry van and box
  truck loads are DAT only, so those inquiries are DAT; a load on one board only = that board.
- No bar on: your customers' emails, truck lists (Foreway), Highway / Salesforce notices, RFQs, rate cons,
  POD / BOL / tracking, "Load #131015" updates on booked loads.

IF IT CAN'T TELL WHICH LOAD
- The bar shows "Which load is this?" with your closest loads. Pick one.
- Nothing close: click Sync (pulls DAT + Truckstop now) or "Enter details" to type the load once.
- Missing rate on a post: the bar asks for it before Reply.
- "Edit load" changes hours / weight / commodity / rate for that load, and every later reply uses it.

UPDATES (same as SPOTR)
- New versions are put into Documents\TRUCKR by Claude. Click "Check for updates" in the TRUCKR popup and it
  switches over (your settings and saved loads are kept). It never updates on its own.
- "Check for updates" also pulls reply rules from GitHub (ycmxrrow/truckr-updates: rules.json), so new skip rules
  and accessorial phrases can go live without a new version, and it tells you when GitHub has a newer version.
