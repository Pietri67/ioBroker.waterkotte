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
	// data0 - lowByte, data3 - highByte - BigEndian
	return Number(Buffer.from([data3, data2, data1, data0]).readFloatBE(0).toFixed(2));
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
* hour of time, value in ms -> day 86400 sec -> 86400000 ms
* @param {any} value
*/
function hour_of_time(value) {
	return Math.trunc(value / 3600000);
}


/**
 * bytes to integer
 * @param {number} highByte
 * @param {number} lowByte
 */
function bytes_to_integer(highByte, lowByte) {
	return (highByte * 256) + lowByte;
}


/**
* min of time, value in ms -> day 86400 sec -> 86400000 ms
* @param {any} value
*/
function min_of_time(value) {
	return Math.trunc((value % 3600000) / 60000 );
}


/**
 * @param {any} data
 */
function SendData(data) {
	this.data = data;
	this.next = null;
}

function Queue() {
	this.head = null;
	this.tail = null;
}

Queue.prototype.enqueue = function(data) {
	const newNode = new SendData(data);
	if (this.head === null) {
		this.head = newNode;
		this.tail = newNode;
	} else {
		// @ts-ignore
		this.tail.next = newNode;
		this.tail = newNode;
	}
};

Queue.prototype.dequeue = function() {
	let newNode;
	if (this.head !== null) {
		newNode = this.head.data;
		this.head = this.head.next;
	}
	return newNode;
};

Queue.prototype.empty = function() {
	if (this.head === null) {
		return true;
	} else {
		return false;
	}
};

module.exports = {
	calcCRC16,
	DataToString,
	convert754,
	tod,
	hour_of_time,
	min_of_time,
	bytes_to_integer,
	Queue,
	SendData
};
