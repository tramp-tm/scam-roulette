/**
 * Generates a random color with good contrast for white text.
 * Uses HSL to ensure colors are dark enough (lightness 20-45%).
 */
export function generateRandomReadableColor(): string {
    const hue = Math.floor(Math.random() * 360);
    const saturation = Math.floor(Math.random() * 40) + 60; // 60-100%
    const lightness = Math.floor(Math.random() * 25) + 20; // 20-45%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Brightens a color by the specified percentage.
 * Converts hex to RGB, brightens each channel, returns rgb() string.
 */
export function brightenColor(color: string, percent: number): string {
    let r = 0, g = 0, b = 0;
    
    if (color.length === 4) {
        r = parseInt('0x' + color[1] + color[1]);
        g = parseInt('0x' + color[2] + color[2]);
        b = parseInt('0x' + color[3] + color[3]);
    } else if (color.length === 7) {
        r = parseInt('0x' + color[1] + color[2]);
        g = parseInt('0x' + color[3] + color[4]);
        b = parseInt('0x' + color[5] + color[6]);
    }

    r = Math.min(255, r + percent);
    g = Math.min(255, g + percent);
    b = Math.min(255, b + percent);

    return `rgb(${r}, ${g}, ${b})`;
}

