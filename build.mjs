import * as esbuild from 'esbuild';
import {mkdirSync, readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

const watch = process.argv.includes('--watch');

mkdirSync('dist/chunks', { recursive: true });

const common = {
    bundle: true,
    sourcemap: true,
    minify: false,
    target: ['chrome120'],
    logLevel: 'info',
    platform: 'browser',
    plugins: watch ? [{name:'build-id', setup(build) {build.onEnd(result=>{
        if (!result.errors.length) {
            clearTimeout(buildInfoTimer);
            buildInfoTimer = setTimeout(writeBuildInfo, 150);
        }
    });}}] : []
};
let buildInfoTimer;

const contentOptions = {
    ...common,
    entryPoints: ['content.js'],
    outfile: 'dist/content.js',
    format: 'iife'
};

const moderatorOptions = {
    ...common,
    entryPoints: ['modules/ModeratorService.js'],
    outfile: 'dist/chunks/moderator.js',
    format: 'esm'
};
const bridgeOptions = {...common, entryPoints: ['modules/analytics/SiteReadBridge.js'], outfile: 'dist/siteBridge.js', format: 'iife'};
function writeBuildInfo() {
    const files = ['manifest.json', 'config.json', 'background.js', 'popup.js', 'popup.html', 'popup.css', 'analytics.js', 'analytics.html', 'dist/content.js', 'dist/chunks/moderator.js', 'dist/siteBridge.js'];
    for (const dir of ['modules', 'css', 'icons']) for (const entry of readdirSync(dir, {recursive: true})) {
        if (/\.(js|css|json|png|svg|ico)$/.test(entry)) files.push(dir + '/' + entry.replaceAll('\\', '/'));
    }
    const hash = createHash('sha256');
    for (const file of [...new Set(files)].sort()) hash.update(file).update(readFileSync(file));
    writeFileSync('build-info.json', JSON.stringify({version: JSON.parse(readFileSync('manifest.json')).version, build: hash.digest('hex').slice(0, 12)}, null, 2) + '\n');
}

if (watch) {
    const contentCtx = await esbuild.context(contentOptions);
    const moderatorCtx = await esbuild.context(moderatorOptions);
    const bridgeCtx = await esbuild.context(bridgeOptions);
    await Promise.all([contentCtx.watch(), moderatorCtx.watch(), bridgeCtx.watch()]);
    console.log('[iohelper] watching…');
} else {
    await Promise.all([
        esbuild.build(contentOptions),
        esbuild.build(moderatorOptions), esbuild.build(bridgeOptions)
    ]);
    writeBuildInfo();
}
