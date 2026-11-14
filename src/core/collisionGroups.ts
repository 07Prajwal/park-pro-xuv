/**
 * Rapier interaction groups (upper 16 bits: membership, lower 16 bits: filter).
 * Loose props such as traffic cones are hit by the car body but are invisible
 * to the wheel ray casts, so the car knocks them over instead of driving up them.
 */

const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

const PROP_BIT = 0x0002;
const WHEEL_BIT = 0x0001;

export const PROP_GROUPS = groups(PROP_BIT, 0xffff);
export const WHEEL_QUERY_GROUPS = groups(WHEEL_BIT, 0xffff & ~PROP_BIT);
