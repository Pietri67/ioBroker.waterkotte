// @ts-nocheck
'use strict';

/* Funktioniert nur mit WPCU.C Version 01.04.00 Stand ca. 2010 */

/*
 * Created with @iobroker/create-adapter v1.33.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');


// Load your modules here, e.g.:
const SerialPort = require('serialport');
const InterByteTimeout = require('@serialport/parser-inter-byte-timeout');
const StateList = require('./lib/waterkotte.json');
const WkTools = require('./lib/wk-tools');

// Communication Port/Parser
let commPort = null;
let commParser = null;
let adapter = null;

// Timer ID's
let timerID1 = 0;
let timerID2 = 0;
let timerID3 = 0;
let recTimeout = 0;

// Execution queue
const queue = [];
let parseRequestNum = 1;

// state machine steps...
let currentStep = '';

// Adapter
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
		this.on('unload', this.onUnload.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));

		adapter = this;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Reset the connection indicator during startup
		await this.setStateAsync('info.connection', false, true);

		// try to initialize communication
		if (this.config.usbport) {

			// create serial port
			commPort = new SerialPort(this.config.usbport, {
				baudRate: 9600
			});

			// create parser with timeout
			commParser = commPort.pipe(new InterByteTimeout({interval: 5000}));

			// initialize communication
			await this.communication();
		}

		// Create state list
		this.createStateList();
		this.statemachine('init');
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// stop communication
			if (commPort != null) {
				commPort.close();
			}

			// stop timer
			this.stopTimer();

			// update connection state.
			this.setState('info.connection', false, true);

			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack}) from: ${state.from}`);

			// state.from
			// example: system.adapter.waterkotte.0.
			const adaptTmp = state.from.split('.');
			const adaptFrom = adaptTmp.slice(0,3).join('.');

			if (adaptFrom !== 'system.adapter.waterkotte') {

				// id
				// state waterkotte.0.heating.Off changed: true (ack = false) from: system.adapter.admin.0
				// state waterkotte.0.heating.Off changed: true (ack = false) from: system.adapter.socketio.0
				// state waterkotte.0.heating.Off changed: false (ack = true) from: system.adapter.waterkotte.0
				const stateObject = await this.getObjectAsync(id);
				if (stateObject)  {
					this.log.info(`State '${id}'`);
					this.log.info('Adr: ' + stateObject.native.Adr + ' Enum ' + stateObject.native.Enum);
					this.log.info('new Value: ' + state.val);

					this.setIntegerValue(stateObject.native.Adr, state.val);

				} else {
					this.log.info(`Unable to get state value of '${id}'.`, 'error');
				}
			}

		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
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
			tlg[1] = 5;     // Func.

			tlg[2] = (addr >> 8) & 0xFF;    // Data
			tlg[3] = addr & 0xFF;      		// Data

			if (value === 0) {
				tlg[4] = 0x00;      // Data
			} else {
				tlg[4] = 0xFF;      // Data
			}

			tlg[5] = 0x00;      	// Data

			const crc16 = WkTools.calcCRC16(tlg, 6);
			tlg[6] = (crc16 >> 8) & 0xFF;
			tlg[7] = crc16 & 0xFF;

			/*
			// send Waterkotte telegram
			commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte boolean error sending data: ' + err);
					return;
				}
			});
	*/
			this.log.info('Waterkotte change value: ' + tlg);

		} catch (e) {
			// Logfile
			this.log.error('Waterkotte boolean sent error: ' + e);
		}
	}



	/*
	 *   serial communiation eltako
	 */
	async communication() {

		// port opened
		commPort.on('open', () => {

			// setup parser
			commParser.on('data' , (data) => {

				// Logfile
				this.log.info('Waterkotte response: ' + WkTools.DataToString(data));
				// update info.lastmsg
				this.setState('info.lastmsg', WkTools.DataToString(data), true);

				if (parseRequestNum == 1) {
					this.parseRequest1(data);
				}
				if (parseRequestNum == 2) {
					this.parseRequest2(data);
				}
				if (parseRequestNum == 3) {
					this.parseRequest3(data);
				}
			});

			// update connection state.
			this.setState('info.connection', true, true);

			// Logfile
			this.log.info('Waterkotte usb/serial port ' + this.config.usbport + ' with baudrate ' + this.config.baudrate + ' opened.');
		});

		// port closed
		commPort.on('close', () => {
			// update connection state.
			this.setState('info.connection', false, true);

			// Logfile
			this.log.info('Waterkotte usb/serial port ' + this.config.usbport + ' closed.');
		});

		// port error
		commPort.on('error', (error) => {
			// Logfile
			this.log.info('Waterkotte usb/serial port ' + this.config.usbport + ' error: ' + error);
		});
	}

	/*
	*	StateMachine
	*/
	statemachine(newStep) {

		//adapter.log.info('currentStep: ' + currentStep + ' --> newStep: ' + newStep);

		// step change
		currentStep = newStep;

		// next step
		switch (currentStep) {

			case 'init':
				// initialize
				this.startTimer();
				this.statemachine('idle');
				break;

			case 'idle':
				if (queue.length > 0) {
					this.statemachine('wait');
				}
				break;

			case 'wait':
				setTimeout( ()=>{
					// this.log.info('send delay');
					this.statemachine('send');
				}, 500);
				break;

			case 'send':
				if (queue.length > 0) {
					parseRequestNum = queue.shift();
					if (parseRequestNum == 1) {
						this.requestData1();
					}
					if (parseRequestNum == 2) {
						this.requestData2();
					}
					if (parseRequestNum == 3) {
						this.requestData3();
					}
				} else {
					this.log.warn('queue empty');
					this.statemachine('idle');
				}
				break;

			case 'receive':
				recTimeout = setTimeout( ()=>{
					this.log.warn('Waterkotte timeout receive communication');
					this.statemachine('idle');
				}, this.config.timeout);
				break;

			case 'stop':
				// stop
				this.stopTimer();
				break;

			default:
				adapter.log.info('unknown step');
		}
	}

	/*
	 *   startTimer
	 */
	async startTimer() {

		// Start timer
		timerID1 = setInterval( () => {
			//adapter.log.info('start request1 timer');
			queue.push(1);
			if (currentStep == 'idle') {
				this.statemachine('wait');
			}
		}, (this.config.repeat1 * 60000));

		timerID2 = setInterval( () => {
			//adapter.log.info('start request2 timer');
			queue.push(2);
			if (currentStep == 'idle') {
				this.statemachine('wait');
			}
		}, (this.config.repeat2 * 60000));

		timerID3 = setInterval( () => {
			//adapter.log.info('start request3 timer');
			queue.push(3);
			if (currentStep == 'idle') {
				this.statemachine('wait');
			}
		}, (this.config.repeat3 * 60000));
	}

	/*
	 *   stopTimer
	 */
	async stopTimer() {
		clearInterval(timerID1);
		clearInterval(timerID2);
		clearInterval(timerID3);
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
			commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte request1 error sending data: ' + err);
					this.statemachine('idle');
					return;
				}
			});
			this.log.info('Waterkotte request1: ' + tlg);
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
			commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte request2 error sending data: ' + err);
					this.statemachine('idle');
					return;
				}
			});
			this.log.info('Waterkotte request2: ' + tlg);
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
			commPort.write(tlg, (err) => {
				if (err) {
					this.log.warn('Waterkotte request3 error sending data: ' + err);
					this.statemachine('idle');
					return;
				}
			});
			this.log.info('Waterkotte request3: ' + tlg);
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
		clearTimeout(recTimeout);

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
		clearTimeout(recTimeout);

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

		// reset comm timeout
		clearTimeout(recTimeout);

		// Check CRC
		const len = data[2];
		const crc16 = WkTools.calcCRC16(data, len+3);
		if (((crc16 & 0xff) === data[len+4]) && (((crc16 >> 8) & 0xff) === data[len+3])) {
			//
		} else {
			this.log.warn('CRC error: ' + crc16 + ' <> ' + data[len+3] + ' ' + data[len+4]);
		}

		// finish parsing
		this.statemachine('idle');
	}

	/*
	* create Waterkotte state list
	*/
	async createStateList() {

		// Path
		let path = '';

		// first delete all


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