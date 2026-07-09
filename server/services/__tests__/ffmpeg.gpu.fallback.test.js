import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(() => true),
  },
}));

// Mock VIDEO_ENCODER as a GPU encoder 'h264_qsv'
vi.mock('../platform.js', () => ({
  FFMPEG_PATH: 'ffmpeg',
  getFontPath: () => '/fake/font.ttf',
  VIDEO_ENCODER: 'h264_qsv',
}));

import { spawn } from 'child_process';
import fs from 'fs';
import { cutSegment } from '../ffmpeg.js';

function makeFakeProc(exitCode, message = '') {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    proc.stderr.emit('data', Buffer.from(message));
    proc.emit('close', exitCode);
  });
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cutSegment GPU to CPU fallback ladder', () => {
  it('falls back to CPU (libx264) when GPU (h264_qsv) encoding fails', async () => {
    // 1st invocation (GPU watermarked) fails
    // 2nd invocation (CPU watermarked) succeeds
    spawn.mockImplementation((_bin, args) => {
      const isCpu = args.includes('libx264');
      return makeFakeProc(isCpu ? 0 : 1, isCpu ? '' : 'GPU error');
    });

    const result = await cutSegment('in.mp4', 0, 5, 'out.mp4', 'Hello Title');

    // Should succeed because the CPU retry succeeded
    expect(result).toEqual({ watermarked: true });

    // Expect at least two attempts
    expect(spawn).toHaveBeenCalledTimes(2);

    const firstArgs = spawn.mock.calls[0][1];
    const secondArgs = spawn.mock.calls[1][1];

    // First attempt used GPU (h264_qsv)
    expect(firstArgs.includes('h264_qsv')).toBe(true);

    // Second attempt used CPU (libx264)
    expect(secondArgs.includes('libx264')).toBe(true);
  });

  it('deletes the corrupt output file if all fallbacks fail', async () => {
    // Every call fails
    spawn.mockImplementation(() => makeFakeProc(1, 'Fatal error'));

    // Should throw
    await expect(cutSegment('in.mp4', 0, 5, 'out.mp4', 'Hello Title')).rejects.toThrow();

    // Check that unlinkSync was called for the output path
    expect(fs.unlinkSync).toHaveBeenCalledWith('out.mp4');
  });
});
