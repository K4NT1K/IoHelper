import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

mkdirSync('dist/chunks', { recursive: true });

const common = {
    bundle: true,
    sourcemap: true,
    minify: false,
    target: ['chrome120'],
    logLevel: 'info',
    platform: 'browser'
};

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

if (watch) {
    const contentCtx = await esbuild.context(contentOptions);
    const moderatorCtx = await esbuild.context(moderatorOptions);
    await Promise.all([contentCtx.watch(), moderatorCtx.watch()]);
    console.log('[iohelper] watching…');
} else {
    await Promise.all([
        esbuild.build(contentOptions),
        esbuild.build(moderatorOptions)
    ]);
}
