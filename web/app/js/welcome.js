// welcome.js - what the opening page's ABOUT tab says (home.js draws it): what this project is and how it was made, section by section. It was a page of
// its own, shown on a first visit, until 2026-11-11, when it became that tab. A first visit is still told apart, so that the game's Loading window waits
// for the first screens' files once PLAY ONLINE is pressed.
const KEY = "tsuki.welcomed";

export function welcomeDue(query) {
  if (query.has("script")) return false;   // a test going straight to a scene
  if (query.has("welcome")) return true;
  try { return !localStorage.getItem(KEY); } catch { return true; }
}
// The first visit is made: called once the first screens have loaded (main.js).
export function markWelcomed() {
  try { localStorage.setItem(KEY, "1"); } catch { /* it counts as a first visit again next time */ }
}

// A section: its name, its heading and its blocks: a string is a paragraph, ["h", text] a sub-heading, ["facts", [[number, what], ...]] a row of figures, "logo" the game's logo,
// ["rows", [[name, what, font?], ...]] a list of names, each set in the font given if there is one, ["note", text] a short notice.
export const SECTIONS = [
  { tab: "ABOUT", head: "Tsukihime remake in a browser", blocks: [
    ["note", "For Chrome and Firefox. It does not work in Safari: the movies are AV1 video, which Safari plays only on Apple's newest hardware."],
    "logo",
    "This is the Tsukihime remake, Tsukihime -A piece of blue glass moon-, running in a web page. There is no emulator and no native code here: the game's engine was rewritten in JavaScript and WebGL2, and that new engine plays the game's own scripts, pictures, voices and music.",
    "It grew out of a Windows and Linux port made by recompiling the Nintendo Switch executable. That native build became the reference for this one. Whenever the browser version had to decide how something should look, sound or move, the answer was taken from the game.",
    ["facts", [["5,984", "functions in the game's executable, each one classified"], ["1,078,741", "script commands in 549 scripts"], ["43,960", "lines of dialogue"], ["8,903", "pictures"], ["16,460", "voice clips"], ["45", "movies"]]],
    "The sections below explain how it was built. This is an unofficial, non-commercial fan project, not affiliated with TYPE-MOON or Aniplex.",
  ] },
  { tab: "DECOMPILE", head: "Taking the game apart", blocks: [
    "The game is one AArch64 executable and about 21 GB of archives. The executable was read two ways. A static recompiler turns every machine instruction into C++, and that listing is what the native PC build compiles. Ghidra, run headless over the same image, gives readable C for the large functions. Where the C was unclear, the instruction listing decided.",
    ["h", "Every function accounted for"],
    "Each of the 5,984 functions was classified. Nintendo's libraries and platform plumbing make up 4,161 of them, and small helpers another 1,068. The port implements 565 of the rest, 98 cannot be reached by the shipped scripts, and 20 were replaced on purpose by the mouse and keyboard interface.",
    ["facts", [["5,984", "functions in all"], ["4,161", "platform and libraries"], ["1,068", "helpers"], ["565", "implemented"], ["98", "unreachable"], ["20", "replaced on purpose"]]],
    ["h", "A citation is not proof"],
    "A function counted as handled was not trusted just because the port mentioned it. They went on a list to be read again in the listing, checking every argument, field, default and condition they use. That pass found 217 more differences. One early example: the code was counted as handling motion while reading only 11 of a keyframe's 28 fields.",
    ["h", "Tables and shaders"],
    "The data the engine keeps inside its executable was exported directly: the motion tracks, colour effect presets, the flowchart's rows and links, the script jump table. The game's GPU shaders were translated offline from the Switch's Maxwell format to SPIR-V and read as source, so each blend mode here is the game's own arithmetic.",
  ] },
  { tab: "REBUILD", head: "Rebuilding the engine", blocks: [
    ["h", "The scripts"],
    "The story is written in a small scripting language: 549 scripts and just over a million commands. The interpreter handles more than 90 commands, and it follows the game's timing as well as its meaning. A screen transition takes its stated time plus three frames, because that is what the game does, and under fast forward each frame counts as 33.",
    ["h", "The text window"],
    "Letters appear at the game's own read and unread speeds, in the same frame order, with its readings, balloons, page marks and dimming. A save resumes from the same line the game would, and rewinding keeps the same 800 records.",
    ["h", "Sound"],
    "Music fades run in the game's level units per frame. Delayed sound commands, crossfades, per-character voice volumes and the rules for when one voice cuts another all follow the sound engine's code, measured against recordings of the native build's output.",
    ["h", "Random numbers"],
    "The game has two generators. One is seeded from the console at every launch, so there is nothing to copy. The other is the C library's rand(), which is never seeded, so it gives the same numbers every time. The port draws from that same function in the same order, which makes the first sway after starting match the game cycle for cycle.",
    ["h", "The interface"],
    "The title, menus, config, gallery and flowchart are drawn from the game's art with its timings, then driven by mouse and keyboard rather than a controller. The plates along the top of this page were made the same way: the game's own panel, with its button plates cut and relettered.",
  ] },
  { tab: "GRAPHICS", head: "Pictures and effects", blocks: [
    "Everything on the story screen is drawn by a WebGL2 renderer written for this game. Layers carry the engine's parents, pivots, panel clips, size classes and motion tracks.",
    ["h", "Colour"],
    "Blend modes are reproduced in the game's own working space, with its final display curve applied last. Getting that order right for the text window took the dark parts of the picture behind it from about four levels off to within one.",
    ["h", "Effects"],
    "Wipes through the game's 49 transition masks, screen and layer shakes, sway, speed lines, the RGB split, film grain, and the blurred story behind the menus are all rebuilt from the engine's own numbers.",
    ["h", "Blur"],
    "The game ships 7,286 pre-blurred copies of its pictures, about 8.7 GB. The port makes them as it plays instead. The curve was fitted against about 120 of the game's own pairs: a Gaussian of 0.65 times the script's number times the picture's size class. On native frames the result is within one to three levels.",
  ] },
  { tab: "ASSETS", head: "From 21 GB to 2.7 GB", blocks: [
    "Everything here was made from one owned copy of the game. Only what the game can actually ask for is kept. That list is worked out from the code and the scripts.",
    ["h", "Pictures"],
    "Stored as compressed GPU textures in the game. Each is decoded and saved as AVIF, no larger than the scripts ever draw it. The interface art is lossless WebP.",
    ["h", "Voices and music"],
    "The game's Opus audio is lifted out of Nintendo's container and placed in Ogg packet for packet. Nothing is re-encoded, so no quality is lost.",
    ["h", "Sound effects and movies"],
    "Effects are decoded from the game's ADPCM archive and encoded to Opus. The movies' pictures are encoded again as AV1, at about a quarter of the size, with every frame in its place and its time. Their sound is the game's own, copied untouched. AV1 is why this does not work in Safari.",
    ["facts", [["20.8 GB", "the game's files"], ["2.7 GB", "this folder"], ["0.4 GB", "the 45 movies, 1.8 GB before"], ["16,000", "lines of JavaScript and CSS"], ["113", "lines in the server"]]],
    "The server is a small Python file with no dependencies, there only to hand files to the browser.",
  ] },
  { tab: "TESTING", head: "Checking it against the game", blocks: [
    "Reading the code was only the start. Findings read from the listing are often right and sometimes not, so changes were compared with the real game running.",
    ["h", "The native side"],
    "The PC build runs headless in a sandbox with scripted button presses, dumping every frame and recording its sound. A patch layer replaces the first script with any test scene, so one command can be measured alone. A moving mark on screen acts as a clock, giving the game's exact tick on every frame.",
    ["h", "The browser side"],
    "The port is stepped on a virtual clock, one 60 Hz frame at a time, and compared with the native frames: positions, alpha, colour, letter by letter.",
    ["facts", [["25", "text and script fixes re-run on native frames: 19 matched, 6 corrected"], ["88 / 89", "timed steps under fast forward take the game's number of frames"], ["450+", "automated tests"], ["549", "scripts run end to end by the smoke test"]]],
    // (what was the Extras plate: what can be added to the address, the fonts, and where to take it further)
    ["h", "Extras"],
    ["h", "Opening a particular scene"],
    "Add one of these to the address to go straight to a part of the story:",
    ["rows", [
      ["/?script=00_02", "Opens that script by its name."],
      ["/?script=89", "The same by its number in the list, 0 to 548."],
      ["/?script=04_00_ARC04_4_1&pc=500", "Runs through the scene to command 500, then plays on normally."],
      ["/?script=04_00_ARC04_3&label=LBL_008", "Starts at a label inside the script. Nothing before it has run, so the screen stays empty until the scene next draws a picture."],
      ["&mute", "Added to any of these: no sound at all."],
    ]],
    "Script names are the game's own, and capitals matter. They start with the day, then 00 for Arcueid's route or 01 for Ciel's, as in 04_00_ARC04_4_1 and 05_01_CIEL05_2_2_2. 00_00 to 00_02 are the prologue, QA_01 to QA_24 the Teach Me, Ciel-sensei episodes. All 549 are listed in assets/scripts/index.json.",
    "A scene opened this way starts with the story's flags empty, so one that depends on earlier choices can take a different branch than it would in play. What you read still counts as read. It also skips the opening page, so sound begins at your first click.",
    ["h", "Fonts in this version"],
    "Each name is set in its own font. Only SeuratPro and Inter are included here. The others are looked for on your system, and the next one in line is used where one is missing.",
    ["rows", [
      ["Georgia", "The story, choices, the log and Yes / No questions. Then Times New Roman.", 'Georgia, "Times New Roman", serif'],
      ["SeuratPro M", "Text in speech balloons. This one is the game's own font.", '"SeuratPro", Georgia, serif'],
      ["Inter", "The gallery's lists, the Music Player, the hints along the bottom, the Controls page.", "Inter, sans-serif"],
      ["Helvetica", "The flowchart's cards. Then Arial.", "Helvetica, Arial, sans-serif"],
      ["Apple Chancery", "Chapter names, and the story's old-fashioned lettering. Then Lucida Calligraphy, Monotype Corsiva.", '"Apple Chancery", "Lucida Calligraphy", "Monotype Corsiva", "URW Chancery L", "TeX Gyre Chorus", Georgia, serif'],
      ["Hoefler Text", "The day numbers beside chapter names. Then Palatino, Book Antiqua.", '"Hoefler Text", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'],
      ["PT Sans Narrow", "The words on these plates and the quick bar's. Then Ubuntu Condensed, Arial Narrow.", '"PT Sans Narrow", "Ubuntu Condensed", "Arial Narrow", "Segoe UI", "Helvetica Neue", Arial, sans-serif'],
      ["Ubuntu Condensed", "Chapters on save rows and the flowchart. Then PT Sans Narrow, Arial Narrow.", '"Ubuntu Condensed", "PT Sans Narrow", "Arial Narrow", "Roboto Condensed", Helvetica, Arial, sans-serif'],
      ["Ubuntu", "The day on a save row. Then Helvetica Neue, Segoe UI.", '"Ubuntu", "Helvetica Neue", "Segoe UI", system-ui, sans-serif'],
      ["Eurostile", "The Audio Track label in the menu's header. Then Microgramma, DIN Alternate, Bahnschrift.", '"Eurostile", "Microgramma", "DIN Alternate", "Bahnschrift", "Inter", system-ui, sans-serif'],
      ["System font", "Scene names in the menus and short notices: your system's own interface font.", "system-ui, sans-serif"],
    ]],
    ["h", "The game's own font files"],
    ["rows", [
      ["TT_TsukuMin-D", "ja/TT_TsukuMin-D.ttf"],
      ["TT_TsukuGo-D", "ja2/TT_TsukuGo-D.ttf"],
      ["FOT-SeuratPro-M", "ja3/FOT-SeuratPro-M.otf"],
      ["SeuratPro-M", "ja3/SeuratPro-M.otf, the one used here", '"SeuratPro", Georgia, serif'],
      ["exfont_nx01", "exfont_nx01.bffnt, in Nintendo's own font format"],
    ]],
    ["h", "For anyone taking it further"],
    ["rows", [
      ["tsuki.* in browser storage", "Your saves, settings and progress. Clearing the site's data removes them."],
      ["web-dev/tools/dev_server.py", "Serves the script smoke test at /smoketest.html, which runs all 549 scripts and lists errors."],
      ["web-dev/tools/check_assets.py", "Says whether anything the game can ask for is missing."],
      ["web-dev/tests", "The automated tests: node --test web-dev/tests/*.test.mjs"],
    ]],
  ] },
  { tab: "CREDITS", head: "Credits", blocks: [
    ["h", "The game"],
    "The Tsukihime remake, Tsukihime -A piece of blue glass moon-, and all of its story, art, music and voices belong to TYPE-MOON, Aniplex and the other rights holders. This project is unofficial and non-commercial, and is not affiliated with or endorsed by them. Please support the official release.",
    ["h", "English text"],
    "The English script comes from the Tsukihimates fan translation patch.",
    ["h", "Tools this was built on"],
    "The native port is based on the SuperMarioWonderRecomp recompilation framework by BelmanteGu. Ryujinx's shader translator was used offline. Ghidra was used for decompilation, FFmpeg, SVT-AV1 and Pillow for the conversions. Some menus are set in Inter, under the SIL Open Font License.",
    ["h", "How it was written"],
    "This was built with Claude, Anthropic's AI model, under human direction: the goals, the decisions and the playing and judging of every result were human, and most of the code was written by the AI.",
  ] },
];
// How to play by touch: on a touch device, on the PLAY ONLINE tab (home.js).
export const TOUCH_INTRO = [
  ["h", "Playing by touch"],
  "Hold the device in landscape. Tap to go on. Swipe down on the picture for the controls (auto, skip, save, the menu), and up for the log. Keep a finger on the picture to fast forward, and tap with two fingers to hide the text. In the menus, tap what you want, drag a list to scroll it, and use the Back button at the bottom right to go back.",
];

export function blockEl(b) {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  if (b === "logo") return el("div", "wl-logo");
  if (typeof b === "string") return el("p", "", b);
  if (b[0] === "h") return el("h3", "", b[1]);
  if (b[0] === "note") return el("p", "wl-note", b[1]);
  if (b[0] === "rows") {
    const rows = el("div", "wl-rows");
    for (const [name, what, font] of b[1]) {
      const n = el("span", "wl-name", name);
      if (font) n.style.fontFamily = font;
      rows.append(n, el("span", "wl-what", what));
    }
    return rows;
  }
  const facts = el("div", "wl-facts");
  for (const [n, what] of b[1]) { const f = el("div", "wl-fact"); f.append(el("span", "wl-num", n), el("span", "wl-what", what)); facts.append(f); }
  return facts;
}
