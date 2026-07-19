# Nocturne — Online Othello for Two

A private invitation-based Othello game for Addu (black) and Chellun Kutty (white), built with React, Vite, Firebase Authentication, and Firebase Realtime Database.

## One-time Firebase setup

The app uses anonymous Firebase accounts in the background so each device can securely keep its assigned side without showing a login screen.

1. Open the Firebase console for the `addu-othello` project.
2. Go to **Build → Authentication → Sign-in method**.
3. Enable **Anonymous** sign-in.
4. Go to **Build → Realtime Database → Rules**.
5. Replace the rules with the contents of `database.rules.json`, then publish them.

Firebase denies database access until those two steps are complete.

## Run locally

1. Install Node.js 22 or newer.
2. Run `npm install` once.
3. Run `npm run dev`.
4. Open the local address shown in the terminal.

Use two different browser profiles or an incognito window to test both players locally. A localhost invitation only works on the same computer; sharing between separate devices requires hosting the app on a web address or opening it through a LAN-accessible development address.

## Project configuration

- Firebase settings are read from `.env`.
- Safe placeholder names are documented in `.env.example`.
- `.env` is ignored by Git.
- Realtime Database rules are in `database.rules.json`.
- Firebase Analytics is not installed or initialized.

## Checks

- `npm test` checks the original Othello rules and multiplayer transaction rules.
- `npm run build` creates the production build.
