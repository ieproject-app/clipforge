import rateLimit from 'express-rate-limit';

export const metadataLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30,
    message: { error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

export const processLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { error: 'Download limit reached. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Lightweight limiter for Link Manager CRUD operations (file reads/writes only).
// Higher limit since these are just text file operations, not video downloads.
export const linksLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,
    message: { error: 'Too many link operations. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});
