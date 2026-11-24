// Used only if the libarchive.js package layout can't be found at build time, so the rest of the app still builds.
export const Archive = {
  init() {},
  async open() { throw new Error('7z/RAR/TAR support is not available in this build.'); }
};
