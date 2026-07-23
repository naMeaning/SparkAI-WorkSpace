"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.colorDistance = colorDistance;
exports.estimateBorderColor = estimateBorderColor;
exports.removeConnectedBorderBackgroundPixels = removeConnectedBorderBackgroundPixels;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function colorDistance(data, offset, color) {
    const dr = data[offset] - color[0];
    const dg = data[offset + 1] - color[1];
    const db = data[offset + 2] - color[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
}
function estimateBorderColor(data, width, height) {
    const step = Math.max(1, Math.floor((width + height) / 420));
    const reds = [];
    const greens = [];
    const blues = [];
    function sample(x, y) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] < 8)
            return;
        reds.push(data[offset]);
        greens.push(data[offset + 1]);
        blues.push(data[offset + 2]);
    }
    for (let x = 0; x < width; x += step) {
        sample(x, 0);
        sample(x, height - 1);
    }
    for (let y = 0; y < height; y += step) {
        sample(0, y);
        sample(width - 1, y);
    }
    if (!reds.length)
        return [255, 255, 255];
    reds.sort((left, right) => left - right);
    greens.sort((left, right) => left - right);
    blues.sort((left, right) => left - right);
    const middle = Math.floor(reds.length / 2);
    return [reds[middle], greens[middle], blues[middle]];
}
function chromaMagentaStrength(red, green, blue) {
    const magentaFloor = Math.min(red, blue);
    if (magentaFloor < 88)
        return 0;
    const dominance = magentaFloor - green;
    if (dominance < 22 || green > magentaFloor * 0.86)
        return 0;
    const brightnessScore = clamp((magentaFloor - 88) / 112, 0, 1);
    const dominanceScore = clamp((dominance - 22) / 92, 0, 1);
    const greenSuppressionScore = clamp((magentaFloor * 0.86 - green) / 76, 0, 1);
    const balanceScore = clamp((190 - Math.abs(red - blue)) / 145, 0.2, 1);
    return Math.min(brightnessScore, dominanceScore, greenSuppressionScore) * balanceScore;
}
function medianNumber(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}
/**
 * Image2 occasionally bakes the transparency preview checker into RGB instead
 * of returning a PNG alpha channel.  A single border median is unsafe here:
 * its old 104-distance flood could walk from light-grey squares directly into
 * skin, white products and pale flowers.  Detect the two-dimensional periodic
 * plate first so removal can be compared with the expected square at (x, y).
 */
function detectNeutralCheckerboardPlate(data, width, height) {
    if (width < 24 || height < 24)
        return undefined;
    const borderPixelCount = Math.max(1, width * 2 + Math.max(0, height - 2) * 2);
    const samples = [];
    const sample = (x, y) => {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] < 245)
            return;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 14 || Math.min(red, green, blue) < 185)
            return;
        samples.push([red, green, blue, (red + green + blue) / 3]);
    };
    for (let x = 0; x < width; x += 1) {
        sample(x, 0);
        sample(x, height - 1);
    }
    for (let y = 1; y + 1 < height; y += 1) {
        sample(0, y);
        sample(width - 1, y);
    }
    if (samples.length / borderPixelCount < 0.52 || samples.length < 96)
        return undefined;
    samples.sort((left, right) => left[3] - right[3]);
    let lowLuma = samples[Math.floor(samples.length * 0.2)][3];
    let highLuma = samples[Math.floor(samples.length * 0.8)][3];
    for (let pass = 0; pass < 8; pass += 1) {
        let lowSum = 0;
        let lowCount = 0;
        let highSum = 0;
        let highCount = 0;
        for (const item of samples) {
            if (Math.abs(item[3] - lowLuma) <= Math.abs(item[3] - highLuma)) {
                lowSum += item[3];
                lowCount += 1;
            }
            else {
                highSum += item[3];
                highCount += 1;
            }
        }
        if (!lowCount || !highCount)
            return undefined;
        lowLuma = lowSum / lowCount;
        highLuma = highSum / highCount;
    }
    if (lowLuma > highLuma)
        [lowLuma, highLuma] = [highLuma, lowLuma];
    const lumaSeparation = highLuma - lowLuma;
    if (lumaSeparation < 8 || lumaSeparation > 52 || lowLuma < 185)
        return undefined;
    const groups = [[], []];
    for (const item of samples) {
        groups[Math.abs(item[3] - lowLuma) <= Math.abs(item[3] - highLuma) ? 0 : 1].push(item);
    }
    if (Math.min(groups[0].length, groups[1].length) / samples.length < 0.12)
        return undefined;
    const colors = groups.map((group) => {
        const sums = group.reduce((result, item) => {
            result[0] += item[0];
            result[1] += item[1];
            result[2] += item[2];
            return result;
        }, [0, 0, 0]);
        return sums.map((value) => Math.round(value / group.length));
    });
    const paletteDistance = Math.hypot(colors[1][0] - colors[0][0], colors[1][1] - colors[0][1], colors[1][2] - colors[0][2]);
    if (paletteDistance < 13 || paletteDistance > 92)
        return undefined;
    const buildSidePattern = (axis, edge) => {
        const length = axis === "x" ? width : height;
        let pattern = new Uint8Array(length);
        const matched = new Uint8Array(length);
        for (let position = 0; position < length; position += 1) {
            const x = axis === "x" ? position : edge;
            const y = axis === "x" ? edge : position;
            const offset = (y * width + x) * 4;
            const lowDistance = colorDistance(data, offset, colors[0]);
            const highDistance = colorDistance(data, offset, colors[1]);
            const value = lowDistance <= highDistance ? 0 : 1;
            pattern[position] = value;
            const red = data[offset];
            const green = data[offset + 1];
            const blue = data[offset + 2];
            if (data[offset + 3] >= 245 &&
                Math.max(red, green, blue) - Math.min(red, green, blue) <= 18 &&
                Math.min(lowDistance, highDistance) <= 18)
                matched[position] = 1;
        }
        // Compression noise at a square boundary is normally one or two pixels;
        // two small majority passes recover the periodic run without inventing a
        // model-specific fixed grid size.
        for (let pass = 0; pass < 2; pass += 1) {
            const smoothed = new Uint8Array(pattern);
            for (let position = 0; position < length; position += 1) {
                let ones = 0;
                let count = 0;
                for (let cursor = Math.max(0, position - 2); cursor <= Math.min(length - 1, position + 2); cursor += 1) {
                    ones += pattern[cursor];
                    count += 1;
                }
                smoothed[position] = ones * 2 >= count ? 1 : 0;
            }
            pattern = smoothed;
        }
        const runLengths = [];
        let runStart = 0;
        for (let position = 1; position <= length; position += 1) {
            if (position === length || pattern[position] !== pattern[runStart]) {
                runLengths.push(position - runStart);
                runStart = position;
            }
        }
        const interiorRuns = runLengths.slice(1, -1);
        const cellSize = medianNumber(interiorRuns);
        const tolerance = Math.max(2, cellSize * 0.25);
        const regularity = interiorRuns.filter((value) => Math.abs(value - cellSize) <= tolerance).length / Math.max(1, interiorRuns.length);
        let matchedCount = 0;
        for (const value of matched)
            matchedCount += value;
        const paletteMatchRatio = matchedCount / Math.max(1, length);
        const transitionCount = Math.max(0, runLengths.length - 1);
        const plausibleCellCount = transitionCount >= 5 && transitionCount <= Math.ceil(length / 3);
        const plausibleCellSize = cellSize >= 3 && cellSize <= Math.max(3, length / 3);
        const score = plausibleCellCount && plausibleCellSize
            ? regularity * 0.55 + paletteMatchRatio * 0.45
            : 0;
        return {
            edge,
            pattern,
            cellSize,
            cells: runLengths.length,
            paletteMatchRatio,
            regularity,
            score
        };
    };
    const xCandidates = [buildSidePattern("x", 0), buildSidePattern("x", height - 1)]
        .sort((left, right) => right.score - left.score);
    const yCandidates = [buildSidePattern("y", 0), buildSidePattern("y", width - 1)]
        .sort((left, right) => right.score - left.score);
    const x = xCandidates[0];
    const y = yCandidates[0];
    if (x.score < 0.82 || y.score < 0.82 ||
        x.paletteMatchRatio < 0.72 || y.paletteMatchRatio < 0.72 ||
        Math.max(x.cellSize, y.cellSize) / Math.max(1, Math.min(x.cellSize, y.cellSize)) > 1.38)
        return undefined;
    const cornerClass = x.pattern[y.edge];
    if (cornerClass !== y.pattern[x.edge])
        return undefined;
    let borderMatches = 0;
    let borderSamples = 0;
    const inspect = (pixelX, pixelY) => {
        const offset = (pixelY * width + pixelX) * 4;
        const expectedClass = x.pattern[pixelX] ^ y.pattern[pixelY] ^ cornerClass;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        borderSamples += 1;
        if (data[offset + 3] >= 245 &&
            Math.max(red, green, blue) - Math.min(red, green, blue) <= 18 &&
            colorDistance(data, offset, colors[expectedClass]) <= 19)
            borderMatches += 1;
    };
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
        inspect(pixelX, 0);
        inspect(pixelX, height - 1);
    }
    for (let pixelY = 1; pixelY + 1 < height; pixelY += 1) {
        inspect(0, pixelY);
        inspect(width - 1, pixelY);
    }
    const borderMatchRatio = borderMatches / Math.max(1, borderSamples);
    const confidence = (x.score + y.score + borderMatchRatio) / 3;
    if (borderMatchRatio < 0.72 || confidence < 0.8)
        return undefined;
    return { colors, x, y, cornerClass, paletteDistance, borderMatchRatio, confidence };
}
function removeConnectedBorderBackgroundPixels(data, width, height, backgroundColor = estimateBorderColor(data, width, height)) {
    const pixelCount = width * height;
    let existingTransparentPixels = 0;
    for (let offset = 3; offset < data.length; offset += 4) {
        if (data[offset] < 245)
            existingTransparentPixels += 1;
    }
    const existingTransparentRatio = existingTransparentPixels / Math.max(1, pixelCount);
    const chromaLike = backgroundColor[0] >= 175 && backgroundColor[2] >= 145 && backgroundColor[1] <= 125 &&
        chromaMagentaStrength(backgroundColor[0], backgroundColor[1], backgroundColor[2]) >= 0.24;
    if (existingTransparentRatio >= 0.025 && !chromaLike) {
        let visiblePixels = 0;
        for (let offset = 3; offset < data.length; offset += 4) {
            if (data[offset] > 16)
                visiblePixels += 1;
        }
        return {
            backgroundColor,
            transparentRatio: existingTransparentRatio,
            visibleRatio: visiblePixels / Math.max(1, pixelCount),
            remainingChromaRatio: 0,
            removedPixels: 0,
            usedExistingAlpha: true,
            checkerboardDetected: false,
            checkerboardSuspiciousRemovedPixels: 0,
            checkerboardProtectedPixels: 0
        };
    }
    const checkerboard = chromaLike ? undefined : detectNeutralCheckerboardPlate(data, width, height);
    const checkerHardThreshold = checkerboard
        ? clamp(checkerboard.paletteDistance * 0.3, 7, 11)
        : 0;
    const checkerSoftThreshold = checkerboard
        ? clamp(checkerboard.paletteDistance * 0.55, 12, 19)
        : 0;
    const checkerContinuityThreshold = checkerboard
        ? clamp(checkerboard.paletteDistance * 0.66, 13, 25)
        : 0;
    const floodThreshold = chromaLike ? 154 : checkerboard ? checkerSoftThreshold : 104;
    const hardThreshold = chromaLike ? 70 : checkerboard ? checkerHardThreshold : 54;
    const featherThreshold = chromaLike ? 154 : checkerboard ? checkerSoftThreshold : 104;
    const visited = new Uint8Array(pixelCount);
    const checkerClassification = checkerboard ? new Int8Array(pixelCount).fill(-1) : undefined;
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;
    let checkerboardProtectedPixels = 0;
    const checkerClassAt = (x, y) => {
        if (!checkerboard)
            return 0;
        return checkerboard.x.pattern[x] ^ checkerboard.y.pattern[y] ^ checkerboard.cornerClass;
    };
    const checkerGridTransitionAt = (x, y) => {
        if (!checkerboard)
            return false;
        for (let radius = 1; radius <= 2; radius += 1) {
            if (x >= radius && checkerboard.x.pattern[x] !== checkerboard.x.pattern[x - radius])
                return true;
            if (x + radius < width && checkerboard.x.pattern[x] !== checkerboard.x.pattern[x + radius])
                return true;
            if (y >= radius && checkerboard.y.pattern[y] !== checkerboard.y.pattern[y - radius])
                return true;
            if (y + radius < height && checkerboard.y.pattern[y] !== checkerboard.y.pattern[y + radius])
                return true;
        }
        return false;
    };
    const checkerExpectedDistanceAt = (index) => {
        if (!checkerboard)
            return Number.POSITIVE_INFINITY;
        const x = index % width;
        const y = Math.floor(index / width);
        return colorDistance(data, index * 4, checkerboard.colors[checkerClassAt(x, y)]);
    };
    const checkerForegroundContinues = (index, expectedClass) => {
        if (!checkerboard)
            return false;
        const x = index % width;
        const y = Math.floor(index / width);
        const offset = index * 4;
        // The resampled boundary between the two checker colours legitimately has
        // the same intermediate grey one cell away.  Only bypass continuity for
        // that tightly neutral midpoint; pale skin or merchandise crossing the
        // same grid coordinate still receives the foreground guard.
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const paletteMidpoint = (checkerboard.colors[0][0] + checkerboard.colors[0][1] + checkerboard.colors[0][2] +
            checkerboard.colors[1][0] + checkerboard.colors[1][1] + checkerboard.colors[1][2]) / 6;
        if (checkerGridTransitionAt(x, y) &&
            Math.max(red, green, blue) - Math.min(red, green, blue) <= 4 &&
            Math.abs((red + green + blue) / 3 - paletteMidpoint) <= 7)
            return false;
        const stepX = Math.max(3, Math.round(checkerboard.x.cellSize));
        const stepY = Math.max(3, Math.round(checkerboard.y.cellSize));
        const neighbours = [
            [x - stepX, y],
            [x + stepX, y],
            [x, y - stepY],
            [x, y + stepY]
        ];
        let continuitySupports = 0;
        for (const [nextX, nextY] of neighbours) {
            if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height)
                continue;
            const nextClass = checkerClassAt(nextX, nextY);
            if (nextClass === expectedClass)
                continue;
            const nextIndex = nextY * width + nextX;
            const nextOffset = nextIndex * 4;
            if (data[nextOffset + 3] < 245)
                continue;
            const pixelDistance = Math.hypot(data[offset] - data[nextOffset], data[offset + 1] - data[nextOffset + 1], data[offset + 2] - data[nextOffset + 2]);
            const nextExpectedDistance = colorDistance(data, nextOffset, checkerboard.colors[nextClass]);
            // Checker squares change by the full palette distance one cell away.
            // A similarly coloured pixel that does not match the opposite square is
            // therefore continuous foreground (skin, cloth, a white petal), not the
            // checker plate.  Keeping this native signal prevents tile-sized holes.
            if (pixelDistance <= checkerContinuityThreshold &&
                nextExpectedDistance > checkerSoftThreshold + 2)
                continuitySupports += 1;
        }
        if (continuitySupports >= 2)
            return true;
        if (continuitySupports === 1) {
            let localForegroundEvidence = 0;
            for (let localY = Math.max(0, y - 2); localY <= Math.min(height - 1, y + 2); localY += 1) {
                for (let localX = Math.max(0, x - 2); localX <= Math.min(width - 1, x + 2); localX += 1) {
                    if (localX === x && localY === y)
                        continue;
                    const localIndex = localY * width + localX;
                    const localOffset = localIndex * 4;
                    const localRed = data[localOffset];
                    const localGreen = data[localOffset + 1];
                    const localBlue = data[localOffset + 2];
                    const localExpectedClass = checkerClassAt(localX, localY);
                    const localExpectedDistance = colorDistance(data, localOffset, checkerboard.colors[localExpectedClass]);
                    if (Math.max(localRed, localGreen, localBlue) - Math.min(localRed, localGreen, localBlue) > 18 ||
                        localExpectedDistance > checkerSoftThreshold + 4)
                        localForegroundEvidence += 1;
                }
            }
            // One cross-cell match is enough only when the immediate neighbourhood
            // already contains real subject texture.  This preserves small white
            // petals while rejecting checker pixels merely one cell from a subject.
            if (localForegroundEvidence >= 5)
                return true;
        }
        return false;
    };
    const isCheckerBackgroundCandidate = (index) => {
        if (!checkerboard || !checkerClassification)
            return false;
        const cached = checkerClassification[index];
        if (cached >= 0)
            return cached === 1;
        const offset = index * 4;
        if (data[offset + 3] < 8) {
            checkerClassification[index] = 1;
            return true;
        }
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 18) {
            checkerClassification[index] = 0;
            return false;
        }
        const x = index % width;
        const y = Math.floor(index / width);
        const expectedClass = checkerClassAt(x, y);
        const expectedDistance = colorDistance(data, offset, checkerboard.colors[expectedClass]);
        const onGridTransition = checkerGridTransitionAt(x, y);
        const meanLuma = (red + green + blue) / 3;
        const paletteMidpoint = (checkerboard.colors[0][0] + checkerboard.colors[0][1] + checkerboard.colors[0][2] +
            checkerboard.colors[1][0] + checkerboard.colors[1][1] + checkerboard.colors[1][2]) / 6;
        const alternateDistance = colorDistance(data, offset, checkerboard.colors[expectedClass ^ 1]);
        const compressedGridTransition = onGridTransition &&
            Math.max(red, green, blue) - Math.min(red, green, blue) <= 4 &&
            Math.abs(meanLuma - paletteMidpoint) <= 7 &&
            Math.min(expectedDistance, alternateDistance) <= clamp(checkerboard.paletteDistance * 0.8, 19, 28);
        if (expectedDistance > checkerSoftThreshold && !compressedGridTransition) {
            checkerClassification[index] = 0;
            return false;
        }
        if (checkerForegroundContinues(index, expectedClass)) {
            checkerClassification[index] = 2;
            checkerboardProtectedPixels += 1;
            return false;
        }
        checkerClassification[index] = 1;
        return true;
    };
    const enqueue = (index) => {
        if (index < 0 || index >= pixelCount || visited[index])
            return;
        const offset = index * 4;
        const strength = chromaLike ? chromaMagentaStrength(data[offset], data[offset + 1], data[offset + 2]) : 0;
        const backgroundCandidate = checkerboard
            ? isCheckerBackgroundCandidate(index)
            : data[offset + 3] < 8 || colorDistance(data, offset, backgroundColor) <= floodThreshold || strength >= 0.12;
        if (backgroundCandidate) {
            visited[index] = 1;
            queue[tail] = index;
            tail += 1;
        }
    };
    for (let x = 0; x < width; x += 1) {
        enqueue(x);
        enqueue((height - 1) * width + x);
    }
    for (let y = 0; y < height; y += 1) {
        enqueue(y * width);
        enqueue(y * width + width - 1);
    }
    while (head < tail) {
        const index = queue[head];
        head += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        if (x > 0)
            enqueue(index - 1);
        if (x + 1 < width)
            enqueue(index + 1);
        if (y > 0)
            enqueue(index - width);
        if (y + 1 < height)
            enqueue(index + width);
        if (checkerboard) {
            if (x > 0 && y > 0)
                enqueue(index - width - 1);
            if (x + 1 < width && y > 0)
                enqueue(index - width + 1);
            if (x > 0 && y + 1 < height)
                enqueue(index + width - 1);
            if (x + 1 < width && y + 1 < height)
                enqueue(index + width + 1);
        }
    }
    let removedPixels = 0;
    let transparentPixels = 0;
    let visiblePixels = 0;
    let remainingChromaPixels = 0;
    let checkerboardSuspiciousRemovedPixels = 0;
    for (let index = 0; index < pixelCount; index += 1) {
        const offset = index * 4;
        const originalAlpha = data[offset + 3];
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const distance = colorDistance(data, offset, backgroundColor);
        const magentaStrength = chromaLike ? chromaMagentaStrength(red, green, blue) : 0;
        let alphaFactor = 1;
        if (visited[index]) {
            if (checkerboard) {
                const x = index % width;
                const y = Math.floor(index / width);
                const expectedDistance = checkerExpectedDistanceAt(index);
                const onGridTransition = checkerGridTransitionAt(x, y);
                alphaFactor = onGridTransition
                    ? 0
                    : clamp((expectedDistance - hardThreshold) / Math.max(1, featherThreshold - hardThreshold), 0, 1);
            }
            else {
                alphaFactor = chromaLike
                    ? clamp(1 - Math.max(magentaStrength / 0.62, (154 - distance) / 154), 0, 1)
                    : clamp((distance - hardThreshold) / Math.max(1, featherThreshold - hardThreshold), 0, 1);
            }
        }
        else if (chromaLike && magentaStrength >= 0.26) {
            // Image models can leave key-colour islands fully enclosed by the subject.
            // Treat the whole generated layer as a chroma-key plate, not only its border.
            alphaFactor = clamp(1 - magentaStrength / 0.72, 0, 1);
        }
        if (chromaLike && magentaStrength >= 0.72)
            alphaFactor = 0;
        const nextAlpha = Math.min(originalAlpha, Math.round(originalAlpha * alphaFactor));
        if (nextAlpha < originalAlpha) {
            removedPixels += 1;
            if (checkerboard) {
                const channelRange = Math.max(red, green, blue) - Math.min(red, green, blue);
                if (channelRange > 18 ||
                    checkerClassification?.[index] !== 1)
                    checkerboardSuspiciousRemovedPixels += 1;
            }
        }
        data[offset + 3] = nextAlpha;
        if (nextAlpha <= 1) {
            data[offset] = 0;
            data[offset + 1] = 0;
            data[offset + 2] = 0;
        }
        else if (chromaLike && (magentaStrength > 0.04 || nextAlpha < 245)) {
            const alpha = nextAlpha / 255;
            const spill = Math.max(0, Math.min(red, blue) - green);
            const cleanup = clamp(magentaStrength * 1.25 + (1 - alpha) * 0.9, 0, 1);
            data[offset] = Math.round(clamp(red - Math.min(spill, Math.max(0, red - green)) * cleanup, 0, 255));
            data[offset + 2] = Math.round(clamp(blue - Math.min(spill, Math.max(0, blue - green)) * cleanup, 0, 255));
        }
        if (nextAlpha < 245)
            transparentPixels += 1;
        if (nextAlpha > 16)
            visiblePixels += 1;
        if (nextAlpha > 32 && chromaMagentaStrength(data[offset], data[offset + 1], data[offset + 2]) >= 0.52) {
            remainingChromaPixels += 1;
        }
    }
    return {
        backgroundColor,
        transparentRatio: transparentPixels / Math.max(1, pixelCount),
        visibleRatio: visiblePixels / Math.max(1, pixelCount),
        remainingChromaRatio: remainingChromaPixels / Math.max(1, visiblePixels),
        removedPixels,
        usedExistingAlpha: false,
        checkerboardDetected: Boolean(checkerboard),
        checkerboardCellWidth: checkerboard?.x.cellSize,
        checkerboardCellHeight: checkerboard?.y.cellSize,
        checkerboardColumns: checkerboard?.x.cells,
        checkerboardRows: checkerboard?.y.cells,
        checkerboardPalette: checkerboard?.colors,
        checkerboardBorderMatchRatio: checkerboard?.borderMatchRatio,
        checkerboardConfidence: checkerboard?.confidence,
        checkerboardSuspiciousRemovedPixels,
        checkerboardProtectedPixels
    };
}
