// Each check gets its own persistent test profile; never use real student sessions.
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const assert = require('node:assert/strict');
function verificationProfile() {
 const id = randomUUID();
 return {
  args: ['--campus-verification-profile=' + id],
  async verify(app) {
   const paths = await app.evaluate(({ app }) => ({ actual: app.getPath('userData'), temp: app.getPath('temp') }));
   assert.equal(path.resolve(paths.actual), path.resolve(paths.temp, 'CampusCourseDesktop-verification', id), 'Refusing verification against normal user data.');
  }
 };
}
module.exports = { verificationProfile };
