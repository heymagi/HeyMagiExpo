# Running MAGI on a Mac

A step-by-step guide for someone who has never used Terminal. You don't need to
understand any of it — just follow the steps in order and check the "You should see"
line after each one before moving on.

Set aside about 30 minutes the first time. After that it's about 30 seconds.

**Before you start, you need:**

- A Mac
- An iPhone
- The Mac and the iPhone **on the same Wi-Fi network** (this matters — it will not work otherwise)
- A file called `.env` that Harvey will send you
- Your GitHub login (you may not even need it — see Part 2)

---

## Part 1 — Install Node

Node is the engine that runs the app. It's a normal Mac installer, like installing
anything else. It also installs a second tool called **npm** at the same time, so you
only do this once.

1. Go to **https://nodejs.org**
2. Click the big download button labelled **LTS**. ("LTS" just means the stable
   version — that's the one you want. Don't pick "Current".)
3. It downloads a file ending in **.pkg**. Open it from your Downloads.
4. Click through the installer — Continue, Continue, Agree, Install. It will ask for
   your Mac password. That's normal.
5. When it says the installation was successful, click Close.

### Check it worked

1. Press **Cmd + Space**, type `Terminal`, press **Enter**.

   A window opens with white or black text on a plain background. This is Terminal.
   You type instructions into it and press Enter. That's all it is.

2. Type this exactly, then press Enter:

   ```
   node -v
   ```

3. **You should see:** a version number starting with `v24` (for example `v24.18.1`).

   If it says `command not found`, close Terminal completely (Cmd + Q) and open it
   again — it only notices new software when it starts up.

   If the number starts with `v20` or lower, the app won't run. Go back to nodejs.org
   and make sure you downloaded the **LTS** version.

4. Now type this and press Enter:

   ```
   npm -v
   ```

   **You should see:** a version number like `11.6.2`. Any number is fine. This
   confirms npm came along with Node, which it always does.

**Leave Terminal open.** You'll need it again shortly.

---

## Part 2 — Download the app's code

1. Go to **https://github.com/heymagi/HeyMagiExpo**

   If it asks you to sign in, use your GitHub login. If it just shows you the page,
   even better — you don't need to sign in to download.

2. Find the green **`< > Code`** button near the top right. Click it.
3. In the menu that drops down, click **Download ZIP** at the bottom.
4. The file lands in your **Downloads** folder as `HeyMagiExpo-main.zip`.
5. Double-click it. macOS unzips it into a folder called **`HeyMagiExpo-main`**.
6. Drag that folder out of Downloads and into your **Documents** folder.

   This matters. Things in Downloads get cleared out, and you don't want to lose it.

**You should see:** a folder at **Documents → HeyMagiExpo-main**. Open it and you
should find files called `package.json` and `app.json` sitting at the top level,
alongside folders called `app`, `components` and `docs`.

> If instead you see a *single folder* inside with everything in it, you've gone one
> level too shallow — use that inner folder for the rest of this guide.

---

## Part 3 — Add the `.env` file

Harvey will send you a file called **`.env`**. It holds the keys that let the app talk
to its database. Without it the app opens but can't load or save anything.

This is the fiddliest step, because macOS hides files whose names start with a dot.

1. Open your **Documents → HeyMagiExpo-main** folder in Finder.
2. Press **Cmd + Shift + .** (that's Command, Shift, and the full stop key).

   Hidden files appear, greyed out. You'll now see a file called `.gitignore` and
   maybe others. This confirms hidden files are showing.

3. Drag the `.env` file Harvey sent you into this folder. It must sit at the **top
   level** — right next to `package.json`, not inside any of the sub-folders.
4. Press **Cmd + Shift + .** again to re-hide them if you prefer. It makes no
   difference to the app.

**You should see:** `.env` listed in the folder alongside `package.json`.

> **Two things that commonly go wrong here:**
>
> - If the file arrived named `env` or `.env.txt`, rename it to exactly `.env` —
>   Finder will warn you about changing the extension; say yes.
> - Don't open it in TextEdit and re-save it. TextEdit likes to add `.txt` on the end.
>   If you need to look inside it, that's fine, just close it without saving.

---

## Part 4 — Install the app's building blocks

The code you downloaded doesn't include the libraries it depends on — they're fetched
separately. This is what npm is for.

1. Go back to Terminal.
2. Type `cd` followed by **one space**. Don't press Enter yet:

   ```
   cd 
   ```

3. Now drag the **HeyMagiExpo-main folder** from Finder directly onto the Terminal
   window and let go.

   Terminal fills in the folder's location for you. This is much more reliable than
   typing it, and it handles spaces in folder names correctly.

4. *Now* press Enter.

   **You should see:** the text to the left of your cursor changes to end in
   `HeyMagiExpo-main`. That means Terminal is now "inside" that folder — every
   instruction from here on applies to the app.

5. Type this and press Enter:

   ```
   npm install
   ```

6. **Wait.** This takes 2–5 minutes. You'll see a spinner and lots of scrolling text.

   **You should see,** eventually: a line like `added 1247 packages in 3m`.

   Warnings in yellow are normal and can be ignored. Even a few lines mentioning
   `deprecated` are fine. Only red text saying `ERR!` is a real problem.

You only ever have to do this once, unless Harvey tells you the code has changed.

---

## Part 5 — Put Expo Go on your iPhone

**Expo Go** is a free app that runs MAGI on your phone without it needing to be in the
App Store.

1. Open the **App Store** on your iPhone.
2. Search for **Expo Go** and install it. (Blue icon, published by "650 Industries".)
3. Open it once so it's ready, then leave it.

---

## Part 6 — Start the app

1. In Terminal — still inside the HeyMagiExpo-main folder — type this and press Enter:

   ```
   npm run dev
   ```

2. **You should see:** some startup text, then a large **QR code** made of black
   squares, and a line underneath beginning `exp://` followed by numbers.

   The first start takes 30–60 seconds. Later ones are quicker.

3. On your iPhone, open the ordinary **Camera** app and point it at the QR code on
   your Mac's screen. Don't take a photo — just hold it steady.

4. A notification slides down from the top of the phone. **Tap it.**

5. Expo Go opens and shows a loading bar while it builds the app. The first time this
   takes a minute or two — the bar can sit near the end for a while, which is normal.

**You should see:** MAGI opens on your phone.

Leave the Terminal window open the whole time. It's doing the work — closing it stops
the app on your phone.

### Stopping it

Click on the Terminal window and press **Ctrl + C**. (Control, not Command.) The app
stops on your phone. Nothing is lost.

### Starting it again another day

Much shorter, because Parts 1–5 are already done:

1. Open Terminal.
2. Type `cd `, drag the folder on, press Enter.
3. Type `npm run dev`, press Enter.
4. Scan the QR code with the Camera app.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `command not found: node` | Quit Terminal completely (Cmd + Q) and reopen it. If it still says this, Node didn't install — repeat Part 1. |
| `command not found: npm` | Same as above. npm comes with Node, so if one is missing both are. |
| `ENOENT: no such file or directory, open 'package.json'` | Terminal isn't in the right folder. Redo step 4.2–4.4: type `cd `, drag the folder on, press Enter. |
| `npm install` fills the screen with red `ERR!` | Usually the Wi-Fi dropped. Check you're online, then run `npm install` again — it picks up where it left off. |
| QR code appears but the phone does nothing when you point at it | The Mac and the iPhone are on different Wi-Fi networks. Check both — phone Wi-Fi settings, and the Wi-Fi menu on the Mac. Guest networks and work networks often block this even when both devices say they're connected. |
| macOS asks to let Terminal "find devices on your local network" | Click **Allow**. If you clicked Don't Allow by mistake: System Settings → Privacy & Security → Local Network → switch Terminal on. The QR code will not work until you do. |
| Expo Go opens but says it can't find the project, or asks you to sign in | Create a free account at **expo.dev**, sign in on the phone in Expo Go, then in Terminal run `npx expo login` and sign in with the same account. Stop the app (Ctrl + C) and run `npm run dev` again. |
| App opens but is blank, or says it can't connect | The `.env` file is missing or in the wrong place. Go back to Part 3 and check it sits next to `package.json`. |
| Something else | Take a photo of the whole Terminal window — including the text above the error — and send it to Harvey. The lines above the error usually matter more than the error itself. |

---

## One last thing

None of this can break anything. The app runs on your Mac and your phone only. You
can't damage the live product, you can't delete anyone's data, and if it all goes
wrong you can drag the folder to the Bin and start again from Part 2.
