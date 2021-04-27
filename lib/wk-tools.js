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
	const mask = ((msb - 1) << 1) | 1;

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

		for (let i = 0; i < 8; i++) {
			let topbit = crc & msb;
			if (octet & (0x80 >> i)) topbit ^= msb;
			crc <<= 1;
			if (topbit) crc ^= poly;
		}
		crc &= mask;
	}

	// output mirror
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
 * @param {{ toString: (arg0: number) => string; }} data0
 * @param {{ toString: (arg0: number) => string; }} data1
 * @param {{ toString: (arg0: number) => string; }} data2
 * @param {{ toString: (arg0: number) => string; }} data3
 */
function convert754(data3, data2, data1, data0)
{
	const res = '0x' + data3.toString(16) + data2.toString(16) + data1.toString(16) + data0.toString(16);
	const int = parseInt(res, 16);
	if (int > 0 || int < 0) {
		const sign = (int >>> 31) ? -1 : 1;
		const mantissa = ((int & 0x7fffff) + 0x800000).toString(2);
		let exp = (int >>> 23 & 0xff) - 127;
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