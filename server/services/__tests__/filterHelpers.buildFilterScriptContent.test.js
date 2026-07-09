import { describe, it, expect } from 'vitest';
import { buildFilterScriptContent } from '../filterHelpers.js';

describe('buildFilterScriptContent', () => {
    it('returns empty content when no filters are active', () => {
        const res = buildFilterScriptContent({
            watermarkTextFilePath: null,
            fontPath: null,
            shortsFormat: 'original',
            copyrightBypass: false,
        });
        expect(res.filterContent).toBe('');
        expect(res.hasVideoFilter).toBe(false);
        expect(res.hasAudioFilter).toBe(false);
    });

    it('generates correct filters for copyright bypass only', () => {
        const res = buildFilterScriptContent({
            watermarkTextFilePath: null,
            fontPath: null,
            shortsFormat: 'original',
            copyrightBypass: true,
        });
        expect(res.filterContent).toContain('hflip,setpts=0.97*PTS,eq=contrast=1.03:saturation=1.05[v_proc]');
        expect(res.filterContent).toContain('[v_proc]null[v]');
        expect(res.filterContent).toContain('[0:a]atempo=1.03[a]');
        expect(res.hasVideoFilter).toBe(true);
        expect(res.hasAudioFilter).toBe(true);
    });

    it('generates correct filters for blurred background shorts format only', () => {
        const res = buildFilterScriptContent({
            watermarkTextFilePath: null,
            fontPath: null,
            shortsFormat: 'vertical_blurred',
            copyrightBypass: false,
        });
        expect(res.filterContent).toContain('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:10,format=yuv420p[bg]');
        expect(res.filterContent).toContain('overlay=0:(main_h-overlay_h)/2:format=yuv420[v_vertical]');
        expect(res.filterContent).toContain('[v_vertical]null[v]');
        expect(res.hasVideoFilter).toBe(true);
        expect(res.hasAudioFilter).toBe(false);
    });

    it('generates correct filters for center crop shorts format only', () => {
        const res = buildFilterScriptContent({
            watermarkTextFilePath: null,
            fontPath: null,
            shortsFormat: 'vertical_crop',
            copyrightBypass: false,
        });
        expect(res.filterContent).toContain('crop=in_h*9/16:in_h,scale=1080:1920,format=yuv420p[v_vertical]');
        expect(res.filterContent).toContain('[v_vertical]null[v]');
        expect(res.hasVideoFilter).toBe(true);
        expect(res.hasAudioFilter).toBe(false);
    });

    it('generates correct filters for combined copyright bypass, blurred bg, and watermark', () => {
        const res = buildFilterScriptContent({
            watermarkTextFilePath: 'C:/temp/watermark.txt',
            fontPath: 'C:/Windows/Fonts/arial.ttf',
            shortsFormat: 'vertical_blurred',
            copyrightBypass: true,
        });
        expect(res.filterContent).toContain('[0:v]hflip,setpts=0.97*PTS,eq=contrast=1.03:saturation=1.05[v_proc]');
        expect(res.filterContent).toContain('[v_proc]scale=1080:1920:force_original_aspect_ratio=increase');
        expect(res.filterContent).toContain('drawtext=textfile=');
        expect(res.filterContent).toContain('[0:a]atempo=1.03[a]');
        expect(res.hasVideoFilter).toBe(true);
        expect(res.hasAudioFilter).toBe(true);
    });

    it('ignores subtitles filter when autoCaptionsSrtPath is provided since it is disabled', () => {
        const res = buildFilterScriptContent({
            watermarkTextFilePath: null,
            fontPath: null,
            shortsFormat: 'original',
            copyrightBypass: false,
            autoCaptionsSrtPath: 'C:\\temp\\subtitles.srt',
        });
        expect(res.filterContent).not.toContain("subtitles=");
        expect(res.hasVideoFilter).toBe(false);
        expect(res.hasAudioFilter).toBe(false);
    });
});
