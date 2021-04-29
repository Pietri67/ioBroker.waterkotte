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
	return Buffer.from([data3, data2, data1, data0]).readFloatBE(0);
}

/**
 * time of day (in ms)
 * @param {*} hour
 * @param {*} minute
 * @param {*} second
 */
function tod(hour, minute, second) {

	const t = (second * 1000) + (minute * 60000) + (hour * 3600000);
	return t;
}

/**
 * bytes to integer
 * @param {number} highByte
 * @param {number} lowByte
 */
function bytes_to_integer(highByte, lowByte) {
	return (highByte * 256) + lowByte;
}



module.exports = {
	calcCRC16,
	DataToString,
	convert754,
	tod,
	bytes_to_integer
};