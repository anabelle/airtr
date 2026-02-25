const MIN_FLIGHT_NUMBER = 100;
const MAX_FLIGHT_NUMBER = 9999;
const FLIGHT_NUMBER_RANGE = MAX_FLIGHT_NUMBER - MIN_FLIGHT_NUMBER + 1;

function hashSeed(seed: string) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

export function getFlightNumber(icaoCode: string, seed: string) {
    const normalizedIcao = (icaoCode || 'UNK').toUpperCase();
    const number = (hashSeed(seed) % FLIGHT_NUMBER_RANGE) + MIN_FLIGHT_NUMBER;
    return `${normalizedIcao} ${number}`;
}
