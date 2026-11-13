// sign-mac.js - the Mac app's signature, made with the system's own codesign (package.json "mac.sign").
// The app is signed only for the computer's sake ("ad hoc", no certificate): macOS on Apple silicon runs nothing unsigned, and the
// signature seals the 10,500 files in the app. electron-builder's own signer first opens every one of those files at once to look
// for programs among them, which is more than macOS lets one process hold open on a Mac with 8 GB (10,240): the build then stops
// with "EMFILE: too many open files". codesign reads them one after another.
const { execFileSync } = require("node:child_process");

exports.default = async function sign(options) {
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", options.app], { stdio: "inherit" });
};
