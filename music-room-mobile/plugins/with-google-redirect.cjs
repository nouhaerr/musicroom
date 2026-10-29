const { withAppDelegate } = require('expo/config-plugins');

function addGoogleRedirect(source) {
  const anchor = 'return super.application(app, open: url, options: options)';
  const handler = 'GIDSignIn.sharedInstance.handle(url)';
  if (!source.includes(handler)) {
    if (!source.includes(anchor)) {
      throw new Error('Google redirect: AppDelegate layout changed; update the URL handler plugin before building iOS.');
    }
    source = source.replace(anchor, `return ${handler} || super.application(app, open: url, options: options)`);
  }
  if (!/^import GoogleSignIn$/m.test(source)) source = `import GoogleSignIn\n${source}`;
  return source;
}

module.exports = config => withAppDelegate(config, result => {
  if (result.modResults.language !== 'swift') throw new Error('Google redirect requires the Expo Swift AppDelegate.');
  result.modResults.contents = addGoogleRedirect(result.modResults.contents);
  return result;
});
module.exports.addGoogleRedirect = addGoogleRedirect;
