/* eslint-disable no-mixed-spaces-and-tabs */

'use strict';

/**
 * Waterkotte CRC calulation
 * @param {any[]} data
 * @param {number} len
 */
function calcCRC16(data, len) {

	const width = 16;
	const msb = 1 << (width - 1);

	const poly = 0x8005;
	let crc = 0xFFFF;

	for (let n = 0; n < len; n++) {
		let octet = data[n];

		// mirror
		let res = 0;
		for (let m = 0; m < 8; m++) {
			res = res << 1 | octet & 1;
			octet >>= 1;
		}
		octet = res;

		crc ^= (octet << 8) & 0xFFFF;
		for (let i = 0; i < 8; i++) {

			if ((crc & msb) !== 0) {
				crc = ((crc << 1) & 0xFFFF) ^ poly;
			} else {
				crc = ((crc << 1) & 0xFFFF);
			}
		}
	}

	// reflect output
	let res = 0;
	for (let k = 0; k < 16; k++) {
		if ((crc & (1 << k)) != 0) {
			res |= ((1 << (15 - k)) & 0xFFFF);
		}
	}
	crc = res;

	// change high/low byte
	crc = ((crc << 8) & 0xFF00)  | ((crc >> 8) & 0xFF);
	return crc;
}

/**
 * Waterkotte data to string
 * @param {any[]} data
 */
function DataToString(data) {

	let res = '';
	for (let i = 0; i < data.length; i++) {
		res += data[i] + ',';
	}
	return res;
}

/**
 * IEEE-754 Floating Point Converter
 * @param {number} data3
 * @param {number} data2
 * @param {number} data1
 * @param {number} data0
 */
function convert754(data3, data2, data1, data0)
{
	const value = data3*0x1000000 + data2*0x10000 + data1*0x100 + data0;
	if (value > 0 || value < 0) {
		const sign = (value >>> 31) ? -1 : 1;
		const mantissa = ((value & 0x7fffff) + 0x800000).toString(2);
		let exp = (value >>> 23 & 0xff) - 127;
		let float32 = 0;
		for (let i = 0; i < mantissa.length; i += 1) { float32 += parseInt(mantissa[i]) ? Math.pow(2, exp) : 0; exp--;}
		return float32 * sign;
	} else return 0;
}

module.exports = {
	calcCRC16,
	DataToString,
	convert754
};