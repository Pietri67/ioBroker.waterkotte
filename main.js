'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");
// @ts-ignore
const { SerialPort } = require('serialport');
// @ts-ignore
const { InterByteTimeoutParser } = require('@serialport/parser-inter-byte-timeout');

// Tools und States
const StateList = require('./lib/waterkotte.json');
const WkTools = require('./lib/wk-tools');




class Waterkotte extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'waterkotte',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));

		this.commQueue = null;

		this.parseRequestNum = 1;

		this.timerID1 = null;
		this.timerID2 = null;
		this.timerID3 = null;

		this.recTimeout = null;
		this.cntTimeout = 0;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here
		this.commPort = null;

		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);
		//this.setState('info.lastmsg', '', true);
		//this.setState('info.tocnt', 0, true);

		// try to initialize communication
		if (this.config.usbport) {

			// create serial port
			this.commPort = new SerialPort({path: this.config.usbport, baudRate: this.config.baudrate });

			// initialize communication
			if (this.commPort != null) {

				// A transform stream that emits data as a buffer after a specific number of bytes are received.
				this.commParser = this.commPort.pipe(new InterByteTimeoutParser({ interval: 30 }));

				await this.communication();
			}
		}

		// create state list
		this.createStateList();

		// create comm queue
		this.commQueue = new WkTools.Queue();

		// init state machin
		this.statemachine('init');
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// update connection state.
			this.setState('info.connection', false, true);

			// Here you must clear all timeouts or intervals that may still be active
			// stop communication
			if (this.commPort != null) {
				this.commPort.close();
			}

		}  finally  {

			// and finish...
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {

		const stateObject = await this.getObjectAsync(id);
		if (state) {

			// state.from
			// example: system.adapter.waterkotte.0.
			const adaptTmp = state.from.split('.');
			const adaptFrom = adaptTmp.slice(0,3).join('.');

			if (adaptFrom !== 'system.adapter.waterkotte') {

				// The state was changed
				this.log.info('state ${id} changed: ${state.val} (ack = ${state.ack}) from: ${state.from}');

				// state waterkotte.0.heating.Off changed: true (ack = false) from: system.adapter.admin.0
				// state waterkotte.0.heating.Off changed: true (ack = false) from: system.adapter.socketio.0
				// state waterkotte.0.heating.Off changed: false (ack = true) from: system.adapter.waterkotte.0

				if (stateObject)  {

					// 4, enum, adr, value
					// @ts-ignore
					this.commQueue.enqueue([4, stateObject.native.Enum, stateObject.native.Adr, state.val]);
					if (this.currentStep == 'idle') {
						this.statemachine('wait');
					}
				} else {
					this.log.info('Unable to get state value of ${id} error');
				}
			}
		} else {
			// The state was deleted
			this.log.info('state ${id} deleted');
		}
	}

	/*
	 *   serial communiation waterkotte
	 */
	async communication() {

		if ((this.commPort != null) && (this.commParser != null)) {

			// port opened
			this.commPort.on('open', () => {

				// update connection state.
				this.setState('info.connection', true, true);

				this.commParser?.on('data', (data) => {
					//this.log.info('Data' + data);

					// Logfile
					this.log.info('Waterkotte response: ' + WkTools.DataToString(data));
					// update info.lastmsg
					//this.setState('info.lastmsg', WkTools.DataToString(data), true);

					if (this.parseRequestNum == 1) {
						this.parseRequest1(data);
					}
					if (this.parseRequestNum == 2) {
						this.parseRequest2(data);
					}
					if (this.parseRequestNum == 3) {
						this.parseRequest3(data);
					}
					if (this.parseRequestNum == 4) {
						this.parseRequest4(data);
					}
				});

				// Logfile
				this.log.info('Waterkotte usb/serial port ' + this.config.usbport + ' with baudrate ' + this.config.baudrate + ' opened.');
			});

			// port closed
			this.commPort.on('close', () => {
			// update connection state.
				this.setState('info.connection', false, true);

				// Logfile
				this.log.info('Waterkotte usb/serial port ' + this.config.usbport + ' closed.');
			});

			// port error
			this.commPort.on('error', (error) => {
			// Logfile
				this.log.info('Waterkotte usb/serial port ' + this.config.usbport + ' error: ' + error);
			});
		}
	}


	/*
	*	StateMachine
	*/
	async statemachine(newStep) {

		//adapter.log.info('currentStep: ' + currentStep + ' --> newStep: ' + newStep);

		// step change
		this.currentStep = newStep;

		// next step
		switch (this.currentStep) {

			case 'init':
				// initialize
				this.cntTimeout = 0;
				//this.setState('info.tocnt', this.cntTimeout, true);
				this.startTimer();
				this.statemachine('idle');
				break;

			case 'idle':
				// @ts-ignore
				if (this.commQueue.empty() === false) {
					this.statemachine('wait');
				}
				break;

			case 'wait':
				setTimeout( ()=>{
					// this.log.info('send delay');
					this.statemachine('send');
				}, 600);
				break;

			case 'send':
				// @ts-ignore
				if (this.commQueue.empty() === false) {

					// @ts-ignore
					const sendData = this.commQueue.dequeue();
					this.parseRequestNum = sendData[0];

					if (this.parseRequestNum == 1) {
						this.requestData1();
					}
					if (this.parseRequestNum == 2) {
						this.requestData2();
					}
					if (this.parseRequestNum == 3) {
						this.requestData3();
					}
					if (this.parseRequestNum == 4) {
						switch(sendData[1]) {
							case 1:
								this.setIntegerValue(sendData[2], sendData[3]);
								break;
							case 2:
								this.setWordValue(sendData[2], sendData[3]);
								break;
							case 3:
								this.setRealValue(sendData[2], sendData[3]);
								break;
							case 4:
								this.setTimeValue(sendData[2], sendData[3]);
								break;
						}
					}
				} else {
					this.log.warn('queue empty');
					this.statemachine('idle');
				}
				break;

			case 'receive':
				this.recTimeout = setTimeout( ()=>{
					this.cntTimeout = this.cntTimeout + 1;
					//this.setState('info.tocnt', this.cntTimeout, true);
					this.log.warn('Waterkotte timeout receive communication');
					this.statemachine('idle');
				}, this.config.timeout);
				break;

			case 'stop':
				// stop
				this.stopTimer();
				break;

			default:
				this.log.info('unknown step');
		}
	}

	/*
	*	write a integer value to waterkotte
	* 	enum == 1
	*/
	async setIntegerValue(addr, value) {
		try
		{
			const tlg = [];

			tlg[0] = 1;     // Adr
			tlg[1] = 0x05;  // Func.

			tlg[2] = (addr >> 8) & 0xFF;    // Data
			tlg[3] = addr & 0xFF;      		// Data

			if (value == 0) {
				tlg[4] = 0x00;      // Data
			} else {
				tlg[4] = 0xFF;      // Data
			}

			tlg[5] = 0x00;      	// Data

			const crc16 = WkTools.calcCRC16(tlg, 6);
			tlg[6] = (crc16 >> 8) & 0xFF;
			tlg[7] = crc16 & 0xFF;

			// send Waterkotte telegram
			// @ts-ignore
			this.commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte boolean data error sending: ' + err);
					this.statemachine('idle');
					return;
				}
			});

			this.log.info('Waterkotte boolean value change: ' + tlg);
			this.statemachine('receive');

		} catch (e) {
			// Logfile
			this.log.error('Waterkotte boolean data sent error: ' + e);
			this.statemachine('idle');
		}
	}

	/*
	*	write a word value to waterkotte
	* 	enum == 2
	*/
	async setWordValue(addr, value) {
		try
		{
			const tlg = [];

			tlg[0] = 1;     // Adr
			tlg[1] = 0x06;  // Func.

			tlg[2] = (addr >> 8) & 0xFF;    // Data
			tlg[3] = addr & 0xFF;      		// Data

			tlg[4] = (value >> 8) & 0xFF;   // Data
			tlg[5] = value & 0xFF;      	// Data

			const crc16 = WkTools.calcCRC16(tlg, 6);
			tlg[6] = (crc16 >> 8) & 0xFF;
			tlg[7] = crc16 & 0xFF;

			// send Waterkotte telegram
			// @ts-ignore
			this.commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte word data error sending: ' + err);
					this.statemachine('idle');
					return;
				}
			});

			this.log.info('Waterkotte word value change: ' + tlg);
			this.statemachine('receive');

		} catch (e) {
			// Logfile
			this.log.error('Waterkotte word data sent error: ' + e);
			this.statemachine('idle');
		}
	}

	/*
	*	write a real value to waterkotte
	* 	enum == 3
	*/
	async setRealValue(addr, value) {
		try
		{
			const tlg = [];

			tlg[0] = 1;     // Adr
			tlg[1] = 0x10;  // Func.

			tlg[2] = (addr >> 8) & 0xFF;    // Data
			tlg[3] = addr & 0xFF;      		// Data
			tlg[4] = 0;      				// Quantity HiByte
			tlg[5] = 2;      				// Quantity LoByte
			tlg[6] = 4;      				// value byte size

			const buf = Buffer.allocUnsafe(4);
			buf.writeFloatBE(value, 0);

			/*
				bei buf.read/write Float hat
				buf0 - HighByte ... buf3 - LowByte

				Adr0 -> buf[2]
				Adr1 -> buf[3]
				Adr2 -> buf[0]
				Adr3 -> buf[1]
			*/

			tlg[7]  = buf[2];
			tlg[8]  = buf[3];
			tlg[9]  = buf[0];
			tlg[10] = buf[1];

			const crc16 = WkTools.calcCRC16(tlg, 11);
			tlg[11] = (crc16 >> 8) & 0xFF;
			tlg[12] = crc16 & 0xFF;

			// send Waterkotte telegram
			// @ts-ignore
			this.commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte real data error sending: ' + err);
					this.statemachine('idle');
					return;
				}
			});

			this.log.info('Waterkotte real value change: ' + tlg);
			this.statemachine('receive');

		} catch (e) {
			// Logfile
			this.log.error('Waterkotte real data sent error: ' + e);
			this.statemachine('idle');
		}
	}

	/*
	*	write a time value to waterkotte
	* 	enum == 4
	*/
	async setTimeValue(addr, value) {
		try
		{
			const tlg = [];

			tlg[0] = 1;     // Adr
			tlg[1] = 0x10;  // Func.

			tlg[2] = (addr >> 8) & 0xFF;    // Data
			tlg[3] = addr & 0xFF;      		// Data
			tlg[4] = 0;      				// Quantity HiByte
			tlg[5] = 1;      				// Quantity LoByte
			tlg[6] = 2;      				// value byte size

			tlg[7]  = (WkTools.hour_of_time(value)) & 0xFF;
			tlg[8]  = (WkTools.min_of_time(value)) & 0xFF;

			const crc16 = WkTools.calcCRC16(tlg, 9);
			tlg[9] = (crc16 >> 8) & 0xFF;
			tlg[10] = crc16 & 0xFF;

			// send Waterkotte telegram
			// @ts-ignore
			this.commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte time data error sending: ' + err);
					this.statemachine('idle');
					return;
				}
			});

			this.log.info('Waterkotte time value change: ' + tlg);
			this.statemachine('receive');

		} catch (e) {
			// Logfile
			this.log.error('Waterkotte time data sent error: ' + e);
			this.statemachine('idle');
		}
	}

	/*
	 *   startTimer
	 */
	async startTimer() {

		// Start timer
		this.timerID1 = setInterval( () => {
			// @ts-ignore
			this.commQueue.enqueue([1, 0, 0, 0]);
			if (this.currentStep == 'idle') {
				this.statemachine('wait');
			}
		}, (this.config.repeat1 * 60000));

		this.timerID2 = setInterval( () => {
			// @ts-ignore
			this.commQueue.enqueue([2, 0, 0, 0]);
			if (this.currentStep == 'idle') {
				this.statemachine('wait');
			}
		}, (this.config.repeat2 * 60000));

		this.timerID3 = setInterval( () => {
			// @ts-ignore
			this.commQueue.enqueue([3, 0, 0, 0]);
			if (this.currentStep == 'idle') {
				this.statemachine('wait');
			}
		}, (this.config.repeat3 * 60000));
	}

	/*
	 *   stopTimer
	 */
	async stopTimer() {
		// @ts-ignore
		const intervalId1 = this.timerID1[Symbol.toPrimitive]();
		clearInterval(intervalId1);

		// @ts-ignore
		const intervalId2 = this.timerID2[Symbol.toPrimitive]();
		clearInterval(intervalId2);

		// @ts-ignore
		const intervalId3 = this.timerID3[Symbol.toPrimitive]();
		clearInterval(intervalId3);
	}


	/*
	*  Request TLG1
	*/
	async requestData1() {
		try
		{
			const tlg = [];

			tlg[0] = 1;     // Adr
			tlg[1] = 3;     // Func.

			tlg[2] = 0x00;      // Data
			tlg[3] = 0x01;      // Data
			tlg[4] = 0x00;      // Data
			tlg[5] = 0x7D;      // Data

			const crc16 = WkTools.calcCRC16(tlg, 6);
			tlg[6] = (crc16 >> 8) & 0xFF;
			tlg[7] = crc16 & 0xFF;

			// send Waterkotte telegram
			// @ts-ignore
			this.commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte request1 error sending data: ' + err);
					this.statemachine('idle');
					return;
				}
			});
			this.statemachine('receive');

		} catch (e) {
			// Logfile
			this.log.error('Waterkotte request1 sent error: ' + e);
			this.statemachine('idle');
		}
	}

	/*
	*  Request TLG2
	*/
	async requestData2() {
		try
		{
			const tlg = [];

			tlg[0] = 1;     // Adr
			tlg[1] = 3;     // Func.

			tlg[2] = 0x07;      // Data
			tlg[3] = 0xD1;      // Data
			tlg[4] = 0x00;      // Data
			tlg[5] = 0x7D;      // Data

			const crc16 = WkTools.calcCRC16(tlg, 6);
			tlg[6] = (crc16 >> 8) & 0xFF;
			tlg[7] = crc16 & 0xFF;

			// send Waterkotte telegram
			// @ts-ignore
			this.commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte request2 error sending data: ' + err);
					this.statemachine('idle');
					return;
				}
			});
			this.statemachine('receive');

		} catch (e) {
			// Logfile
			this.log.error('Waterkotte request2 sent error: ' + e);
			this.statemachine('idle');
		}
	}

	/*
	*  Request TLG3
	*/
	async requestData3() {
		try
		{
			const tlg = [];

			tlg[0] = 1;     // Adr
			tlg[1] = 3;     // Func.

			tlg[2] = 0x0F;      // Data
			tlg[3] = 0xA1;      // Data
			tlg[4] = 0x00;      // Data
			tlg[5] = 0x71;      // Data

			const crc16 = WkTools.calcCRC16(tlg, 6);
			tlg[6] = (crc16 >> 8) & 0xFF;
			tlg[7] = crc16 & 0xFF;

			// send Waterkotte telegram
			// @ts-ignore
			this.commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte request3 error sending data: ' + err);
					this.statemachine('idle');
					return;
				}
			});
			this.statemachine('receive');

		} catch (e) {
			// Logfile
			this.log.error('Waterkotte request3 sent error: ' + e);
			this.statemachine('idle');
		}
	}

	/*
	* Parse requested data1
	*/
	async parseRequest1(data) {

		// reset comm timeout
		// @ts-ignore
		const recTimeoutId = this.recTimeout[Symbol.toPrimitive]();
		clearTimeout(recTimeoutId);

		// Check CRC
		const len = data[2];
		const crc16 = WkTools.calcCRC16(data, len+3);
		if (((crc16 & 0xff) === data[len+4]) && (((crc16 >> 8) & 0xff) === data[len+3])) {

			this.setState('common.OutdoorTemp', WkTools.convert754(data[59], data[60], data[57], data[58]), true);
			this.setState('common.OutdoorTemp1h', WkTools.convert754(data[63], data[64], data[61], data[62]), true);
			this.setState('common.OutdoorTemp24h', WkTools.convert754(data[67], data[68], data[65], data[66]), true);
			this.setState('common.HeatSourceIn', WkTools.convert754(data[71], data[72], data[69], data[70]), true);
			this.setState('common.HeatSourceOut', WkTools.convert754(data[75], data[76], data[74], data[74]), true);
			this.setState('common.EvaporationTemp', WkTools.convert754(data[79], data[80], data[77], data[78]), true);
			this.setState('common.SuctionGasTemp', WkTools.convert754(data[83], data[84], data[81], data[82]), true);
			this.setState('common.EvaporationPress', WkTools.convert754(data[87], data[88], data[85], data[86]), true);
			this.setState('common.ReturnTempTarget', WkTools.convert754(data[91], data[92], data[89], data[90]), true);
			this.setState('common.ReturnTempCurrent', WkTools.convert754(data[95], data[96], data[93], data[94]), true);
			this.setState('common.FlowTemp', WkTools.convert754(data[99], data[100], data[97], data[98]), true);
			this.setState('common.CondensationTemp', WkTools.convert754(data[103], data[104], data[101], data[102]), true);
			this.setState('common.CondensationPress', WkTools.convert754(data[107], data[108], data[105], data[106]), true);
			this.setState('common.RoomTemp', WkTools.convert754(data[111], data[112], data[109], data[110]), true);
			this.setState('common.RoomTemp1h', WkTools.convert754(data[115], data[116], data[113], data[114]), true);
			this.setState('common.DomesticWaterTemp', WkTools.convert754(data[119], data[120], data[117], data[118]), true);


			this.setState('heating.Off', data[130], true);
			this.setState('heating.Begin', WkTools.tod(data[131], data[132], 0), true);
			this.setState('heating.End', WkTools.tod(data[133], data[134], 0), true);
			this.setState('heating.SetPoint', WkTools.convert754(data[137], data[138], data[135], data[136]), true);
			this.setState('heating.SetPointBaseTemp', WkTools.convert754(data[141], data[142], data[139], data[140]), true);
			this.setState('heating.Gradient', WkTools.convert754(data[145], data[146], data[143], data[144]), true);
			this.setState('heating.Limit', WkTools.convert754(data[149], data[150], data[147], data[148]), true);
			this.setState('heating.ReturnTempCurrent', WkTools.convert754(data[153], data[154], data[151], data[152]), true);
			this.setState('heating.ReturnTempTarget', WkTools.convert754(data[157], data[158], data[155], data[156]), true);
			this.setState('heating.Hysteresis', WkTools.convert754(data[161], data[162], data[159], data[160]), true);
			this.setState('heating.RoomTempTarget', WkTools.convert754(data[165], data[166], data[163], data[164]), true);
			this.setState('heating.RoomTempFactor', data[168], true);
			this.setState('heating.SetpointShutOff', data[170], true);
			this.setState('heating.SetpointBegin', WkTools.tod(data[171], data[172], 0), true);
			this.setState('heating.SetpointEnd', WkTools.tod(data[173], data[174], 0), true);
			this.setState('heating.SetpointSum', WkTools.convert754(data[177], data[178], data[175], data[176]), true);
			this.setState('heating.StepMode', data[180], true);
			this.setState('heating.StepModeDiff', WkTools.convert754(data[183], data[184], data[181], data[182]), true);


			this.setState('cooling.Off', data[186], true);
			this.setState('cooling.Begin', WkTools.tod(data[187], data[188], 0), true);
			this.setState('cooling.End', WkTools.tod(data[189], data[190], 0), true);
			this.setState('cooling.SetPoint', WkTools.convert754(data[193], data[194], data[191], data[192]), true);
			this.setState('cooling.ReturnTempCurrent', WkTools.convert754(data[197], data[198], data[195], data[196]), true);
			this.setState('cooling.ReturnTempTarget', WkTools.convert754(data[201], data[202], data[199], data[200]), true);
			this.setState('cooling.Hysteresis', WkTools.convert754(data[205], data[206], data[203], data[204]), true);


			this.setState('hotwater.Off', data[208], true);
			this.setState('hotwater.Begin', WkTools.tod(data[209], data[210], 0), true);
			this.setState('hotwater.End', WkTools.tod(data[211], data[212], 0), true);
			this.setState('hotwater.WaterTempCurrent', WkTools.convert754(data[215], data[216], data[213], data[214]), true);
			this.setState('hotwater.WaterTempTarget', WkTools.convert754(data[219], data[220], data[217], data[218]), true);
			this.setState('hotwater.Hysteresis', WkTools.convert754(data[223], data[224], data[221], data[222]), true);
			this.setState('hotwater.Legionella', WkTools.bytes_to_integer(data[225], data[226]), true);
			this.setState('hotwater.LegionellaOn', WkTools.tod(data[227], data[228], 0), true);
			this.setState('hotwater.LegionellaOff', WkTools.tod(data[229], data[230], 0), true);
			this.setState('hotwater.LegionellaTemp', WkTools.convert754(data[233], data[234], data[231], data[232]), true);

		} else {
			this.log.warn('CRC error: ' + crc16 + ' <> ' + data[len+3] + ' ' + data[len+4]);
		}

		// finish parsing
		this.statemachine('idle');
	}

	/*
	* Parse requested data2
	*/
	async parseRequest2(data) {

		// reset comm timeout
		// @ts-ignore
		const recTimeoutId = this.recTimeout[Symbol.toPrimitive]();
		clearTimeout(recTimeoutId);

		// Check CRC
		const len = data[2];
		const crc16 = WkTools.calcCRC16(data, len+3);
		if (((crc16 & 0xff) === data[len+4]) && (((crc16 >> 8) & 0xff) === data[len+3])) {
			this.setState('step2.Mode', data[76], true);
			this.setState('step2.LimitSource', WkTools.convert754(data[79], data[80], data[77], data[78]), true);

			this.setState('operation.OpComp1', WkTools.convert754(data[83], data[84], data[81], data[82]), true);
			this.setState('operation.OpComp2', WkTools.convert754(data[87], data[88], data[85], data[86]), true);
			this.setState('operation.OpHeatComp1', WkTools.convert754(data[91], data[92], data[89], data[90]), true);
			this.setState('operation.OpHeatStep2', WkTools.convert754(data[95], data[96], data[93], data[94]), true);
			this.setState('operation.OpCooling', WkTools.convert754(data[99], data[100], data[97], data[98]), true);
			this.setState('operation.OpWaterComp1', WkTools.convert754(data[103], data[104], data[101], data[102]), true);
			this.setState('operation.OpWaterStep2', WkTools.convert754(data[107], data[108], data[105], data[106]), true);
			this.setState('operation.OpPoolWater', WkTools.convert754(data[111], data[112], data[109], data[110]), true);
			this.setState('operation.OpSolar', WkTools.convert754(data[115], data[116], data[113], data[114]), true);


			this.setState('failure.Time', data[128] + ':' + data[126] + ':' + data[124], true);
			this.setState('failure.Date', data[156] + '.' + (data[158]+1) + '.' + (data[160]-100), true);

			this.setState('failure.Mode', WkTools.bytes_to_integer(data[175], data[176]), true);
			this.setState('failure.DOBuffer', WkTools.bytes_to_integer(data[177], data[178]), true);
			this.setState('failure.DIBuffer', WkTools.bytes_to_integer(data[179], data[178]), true);
			this.setState('failure.Sensors', WkTools.bytes_to_integer(data[181], data[182]), true);

			this.setState('failure.PressureEvaporation', WkTools.convert754(data[185], data[186], data[183], data[184]), true);
			this.setState('failure.PressureCondensation', WkTools.convert754(data[189], data[190], data[187], data[188]), true);
			this.setState('failure.ReturnTempCurrent', WkTools.convert754(data[193], data[194], data[191], data[192]), true);
			this.setState('failure.FlowTemp', WkTools.convert754(data[197], data[198], data[195], data[196]), true);
			this.setState('failure.HeatSourceIn', WkTools.convert754(data[201], data[202], data[199], data[200]), true);
			this.setState('failure.HeatSourceOut', WkTools.convert754(data[205], data[206], data[203], data[204]), true);
			this.setState('failure.SuctionGasTemp', WkTools.convert754(data[209], data[210], data[207], data[208]), true);
			this.setState('failure.OutdoorTemp', WkTools.convert754(data[213], data[214], data[211], data[212]), true);
			this.setState('failure.DomesticWaterTemp', WkTools.convert754(data[217], data[218], data[215], data[216]), true);

		} else {
			this.log.warn('CRC error: ' + crc16 + ' <> ' + data[len+3] + ' ' + data[len+4]);
		}

		// finish parsing
		this.statemachine('idle');
	}

	/*
	* Parse requested data3
	*/
	async parseRequest3(data) {

		// @ts-ignore
		const recTimeoutId = this.recTimeout[Symbol.toPrimitive]();
		clearTimeout(recTimeoutId);

		// Check CRC
		const len = data[2];
		const crc16 = WkTools.calcCRC16(data, len+3);
		if (((crc16 & 0xff) === data[len+4]) && (((crc16 >> 8) & 0xff) === data[len+3])) {
			this.setState('service.OffsetND', WkTools.convert754(data[5], data[6], data[3], data[4]), true);
			this.setState('service.OffsetHD', WkTools.convert754(data[9], data[10], data[7], data[8]), true);
			this.setState('service.NDState', WkTools.bytes_to_integer(data[11], data[12]), true);

			this.setState('warnings.Failure', WkTools.bytes_to_integer(data[13], data[14]), true);
			this.setState('warnings.Interruptions', WkTools.bytes_to_integer(data[15], data[16]), true);
			this.setState('warnings.Inputs', WkTools.bytes_to_integer(data[17], data[18]), true);
			this.setState('warnings.Outputs', WkTools.bytes_to_integer(data[19], data[20]), true);
			this.setState('warnings.Sensors', WkTools.bytes_to_integer(data[21], data[22]), true);
			this.setState('warnings.Others', WkTools.bytes_to_integer(data[23], data[24]), true);
			this.setState('warnings.SupressInputs', WkTools.bytes_to_integer(data[25], data[26]), true);
			this.setState('warnings.SupressOutputs', WkTools.bytes_to_integer(data[27], data[28]), true);
			this.setState('warnings.SupressSensorik', WkTools.bytes_to_integer(data[29], data[30]), true);
			this.setState('warnings.SupressOthers', WkTools.bytes_to_integer(data[31], data[32]), true);


			this.setState('energy.ElectricPower', WkTools.convert754(data[67], data[68], data[65], data[66]), true);
			this.setState('energy.ThermicPower', WkTools.convert754(data[71], data[72], data[69], data[70]), true);
			this.setState('energy.COP', WkTools.convert754(data[75], data[76], data[73], data[74]), true);

			this.setState('energy.SelectYear', WkTools.bytes_to_integer(data[77], data[78]), true);
			this.setState('energy.SelectType', WkTools.bytes_to_integer(data[79], data[80]), true);
			this.setState('energy.SelectValue', WkTools.convert754(data[83], data[84], data[81], data[82]), true);
			this.setState('energy.PowerPunp', WkTools.convert754(data[87], data[88], data[85], data[86]), true);

			let firmversion = '';
			for (let i = 0; i < 5; i++) {
				firmversion += String.fromCharCode(data[90 + 2*i]);
				firmversion += String.fromCharCode(data[89 + 2*i]);
			}
			this.setState('info.Version', firmversion, true);

			let firmdate = '';
			for (let i = 0; i < 6; i++) {
				firmdate += String.fromCharCode(data[106 + 2*i]);
				firmdate += String.fromCharCode(data[105 + 2*i]);
			}
			this.setState('info.Date', firmdate, true);

			let model = '';
			for (let i = 0; i < 5; i++) {
				model += String.fromCharCode(data[122 + 2*i]);
				model += String.fromCharCode(data[121 + 2*i]);
			}
			this.setState('info.Model', model, true);

			let serial = '';
			for (let i = 0; i < 5; i++) {
				serial += String.fromCharCode(data[138 + 2*i]);
				serial += String.fromCharCode(data[137 + 2*i]);
			}
			this.setState('info.Serial', serial, true);

		} else {
			this.log.warn('CRC error: ' + crc16 + ' <> ' + data[len+3] + ' ' + data[len+4]);
		}

		// finish parsing
		this.statemachine('idle');
	}

	/*
	* Parse requested data4
	*/
	// eslint-disable-next-line no-unused-vars
	async parseRequest4(data) {

		// @ts-ignore
		const recTimeoutId = this.recTimeout[Symbol.toPrimitive]();
		clearTimeout(recTimeoutId);

		// keine Ahnung was hier zurückkommt...

		// finish parsing
		this.statemachine('idle');
	}

	/*
	* create Waterkotte state list
	*/
	async createStateList() {

		// Path
		let path = '';

		// Create tree structure


		// Messwerte
		path = 'common';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(02) Messwerte'
			},
			native: {}
		});

		for (const i in StateList.Common) {

			const subpath = path + '.' + StateList.Common[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Common[i].Desc,
					type: StateList.Common[i].Type,
					role: StateList.Common[i].Role,
					read:  true,
					write: StateList.Common[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Common[i].Write.Enable,
					'Adr':  StateList.Common[i].Write.Adr,
					'Enum': StateList.Common[i].Write.Enum
				}
			});
		}

		// Heizen
		path = 'heating';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(03) Heizen'
			},
			native: {}
		});

		for (const i in StateList.Heating) {

			const subpath = path + '.' + StateList.Heating[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Heating[i].Desc,
					type: StateList.Heating[i].Type,
					role: StateList.Heating[i].Role,
					read:  true,
					write: StateList.Heating[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Heating[i].Write.Enable,
					'Adr':  StateList.Heating[i].Write.Adr,
					'Enum': StateList.Heating[i].Write.Enum
				}
			});

			if (StateList.Heating[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}

		// Kühlen
		path = 'cooling';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(04) Kühlen'
			},
			native: {}
		});

		for (const i in StateList.Cooling) {

			const subpath = path + '.' + StateList.Cooling[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Cooling[i].Desc,
					type: StateList.Cooling[i].Type,
					role: StateList.Cooling[i].Role,
					read:  true,
					write: StateList.Cooling[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Cooling[i].Write.Enable,
					'Adr':  StateList.Cooling[i].Write.Adr,
					'Enum': StateList.Cooling[i].Write.Enum
				}
			});

			if (StateList.Cooling[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}


		// Warmwasser
		path = 'hotwater';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(05) Warmwasser'
			},
			native: {}
		});

		for (const i in StateList.HotWater) {

			const subpath = path + '.' + StateList.HotWater[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.HotWater[i].Desc,
					type: StateList.HotWater[i].Type,
					role: StateList.HotWater[i].Role,
					read:  true,
					write: StateList.HotWater[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.HotWater[i].Write.Enable,
					'Adr':  StateList.HotWater[i].Write.Adr,
					'Enum': StateList.HotWater[i].Write.Enum
				}
			});

			if (StateList.HotWater[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}


		// Stufe2
		path = 'step2';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(09) Stufe2'
			},
			native: {}
		});

		for (const i in StateList.Step2) {

			const subpath = path + '.' + StateList.Step2[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Step2[i].Desc,
					type: StateList.Step2[i].Type,
					role: StateList.Step2[i].Role,
					read:  true,
					write: StateList.Step2[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Step2[i].Write.Enable,
					'Adr':  StateList.Step2[i].Write.Adr,
					'Enum': StateList.Step2[i].Write.Enum
				}
			});
		}

		// Betriebsstunden
		path = 'operation';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(10) Betriebsstunden'
			},
			native: {}
		});

		for (const i in StateList.Operation) {

			const subpath = path + '.' + StateList.Operation[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Operation[i].Desc,
					type: StateList.Operation[i].Type,
					role: StateList.Operation[i].Role,
					read:  true,
					write: StateList.Operation[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Operation[i].Write.Enable,
					'Adr':  StateList.Operation[i].Write.Adr,
					'Enum': StateList.Operation[i].Write.Enum
				}
			});

			if (StateList.Operation[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}

		// Failure
		path = 'failure';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(11) Ausfalldaten'
			},
			native: {}
		});

		for (const i in StateList.Failure) {

			const subpath = path + '.' + StateList.Failure[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Failure[i].Desc,
					type: StateList.Failure[i].Type,
					role: StateList.Failure[i].Role,
					read:  true,
					write: StateList.Failure[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Failure[i].Write.Enable,
					'Adr':  StateList.Failure[i].Write.Adr,
					'Enum': StateList.Failure[i].Write.Enum
				}
			});

			if (StateList.Failure[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}

		// Service
		path = 'service';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(12) Servicedaten'
			},
			native: {}
		});

		for (const i in StateList.Service) {

			const subpath = path + '.' + StateList.Service[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Service[i].Desc,
					type: StateList.Service[i].Type,
					role: StateList.Service[i].Role,
					read:  true,
					write: StateList.Service[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Service[i].Write.Enable,
					'Adr':  StateList.Service[i].Write.Adr,
					'Enum': StateList.Service[i].Write.Enum
				}
			});

			if (StateList.Service[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}

		// Warnings
		path = 'warnings';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(13) Warn/Unterbr/Aus'
			},
			native: {}
		});

		for (const i in StateList.Warnings) {

			const subpath = path + '.' + StateList.Warnings[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Warnings[i].Desc,
					type: StateList.Warnings[i].Type,
					role: StateList.Warnings[i].Role,
					read:  true,
					write: StateList.Warnings[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Warnings[i].Write.Enable,
					'Adr':  StateList.Warnings[i].Write.Adr,
					'Enum': StateList.Warnings[i].Write.Enum
				}
			});

			if (StateList.Warnings[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}

		// Energy
		path = 'energy';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(15) Energieeffizienz'
			},
			native: {}
		});

		for (const i in StateList.Energy) {

			const subpath = path + '.' + StateList.Energy[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Energy[i].Desc,
					type: StateList.Energy[i].Type,
					role: StateList.Energy[i].Role,
					read:  true,
					write: StateList.Energy[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Energy[i].Write.Enable,
					'Adr':  StateList.Energy[i].Write.Adr,
					'Enum': StateList.Energy[i].Write.Enum
				}
			});

			if (StateList.Energy[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}

		// Info
		path = 'info';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: '(16) Information'
			},
			native: {}
		});

		for (const i in StateList.Info) {

			const subpath = path + '.' + StateList.Info[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: '('+ i + ') ' + StateList.Info[i].Desc,
					type: StateList.Info[i].Type,
					role: StateList.Info[i].Role,
					read:  true,
					write: StateList.Info[i].Write.Enable,
					def: ''
				},
				native: {
					'Write': StateList.Info[i].Write.Enable,
					'Adr':  StateList.Info[i].Write.Adr,
					'Enum': StateList.Info[i].Write.Enum
				}
			});

			if (StateList.Info[i].Write.Enable === true) {
				this.subscribeStates(subpath);
			}
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Waterkotte(options);
} else {
	// otherwise start the instance directly
	new Waterkotte();
}