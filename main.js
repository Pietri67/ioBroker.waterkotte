// @ts-nocheck
'use strict';

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

		// remember
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

			// Start polling (1min)
			setInterval(this.requestData1, 60000);
		}

		// Create state list
		this.createStateList();
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
	onStateChange(id, state) {
		if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}


	/*
	 *   serial communiation eltako
	 */
	async communication() {

		// port opened
		commPort.on('open', () => {

			// setup parser
			commParser.on('data' , (tlg) => {
				this.parseRequest1(tlg);
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
					adapter.log.warn('Waterkotte telegram error sending data: ' + err);
					return;
				}
			});

			adapter.log.info('Waterkotte telegram sending data: ' + tlg);

		} catch (e) {
			// Logfile
			adapter.log.error('Waterkotte telegram sent error: ' + e);
		}
	}

	/*
	* Parse requested data
	*/
	async parseRequest1(tlg) {

		const data = tlg;

		// Logfile
		this.log.info('Wk response: ' + WkTools.DataToString(data));

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
			this.setState('common.ReturnTempNominal', WkTools.convert754(data[91], data[92], data[89], data[90]), true);
			this.setState('common.ReturnTemp', WkTools.convert754(data[95], data[96], data[93], data[94]), true);

			this.setState('common.FlowTemp', WkTools.convert754(data[99], data[100], data[97], data[98]), true);
			this.setState('common.CondensationTemp', WkTools.convert754(data[103], data[104], data[101], data[102]), true);
			this.setState('common.CondensationPress', WkTools.convert754(data[107], data[108], data[105], data[106]), true);
			this.setState('common.RoomTemp', WkTools.convert754(data[111], data[112], data[109], data[110]), true);
			this.setState('common.RoomTemp1h', WkTools.convert754(data[115], data[116], data[113], data[114]), true);
			this.setState('common.DomesticWaterTemp', WkTools.convert754(data[119], data[120], data[117], data[118]), true);

		} else {
			this.log.warn('CRC error: ' + crc16 + ' <> ' + data[len+3] + ' ' + data[len+4]);
		}

	}

	/*
	* create Waterkotte state list
	*/
	async createStateList() {

		// Path
		let path = '';

		// first delete all


		// Create tree structure


		// Common
		path = 'common';
		this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: {
				name: 'common'
			},
			native: {}
		});

		for (const i in StateList.Common) {

			const subpath = path + '.' + StateList.Common[i].Name;
			this.setObjectNotExistsAsync(subpath, {
				type: 'state',
				common:
				{
					name: StateList.Common[i].Desc,
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