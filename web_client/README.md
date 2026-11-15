To compile this client, you will need Node (v18+) installed.

Steps to get a development server (for displaying code updates in real-time) for internal testing:
* `npm install` (only needs to be done once, after cloning)
* `npm run dev` (or `npm run host` for non-localhost access)

Steps to compile to a static HTML file for use during the competition:
* `npm install` (only needs to be done once, after cloning)
* `npm run prod`
* Navigate to `./dist/index.html` and open it in your default browser

Note `npm run host` and `npm run prod` are custom flags I introduced for this project - do not expect these commands to work in another Svelte project without updating the `package.json` file accordingly and copying the `./postProcess.js` script.
Both game modes use the arcade score/lives/fruit HUD. Bitmap controls live in the maze's empty side pockets: START/PAUSE and RESET on the left, MUTE/SOUND and ARCADE/COMP on the right. Switching modes changes sequence timing and pause behavior, while retaining the shared screen layout. Competition mode keeps map interaction and does not add arcade holds.
