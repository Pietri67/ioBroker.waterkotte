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
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here
		this.commPort = null;

		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);

		// try to initialize communication
		if (this.config.usbport) {

			// create serial port
			this.commPort = new SerialPort({path: this.config.usbport, baudRate: this.config.baudrate });

			// A transform stream that emits data as a buffer after a specific number of bytes are received.
			this.commParser = this.commPort.pipe(new InterByteTimeoutParser({ interval: 30 }));

			// initialize communication
			if (this.commPort != null) {
				await this.communication();
			}
		}
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
	 *   serial communiation waterkotte
	 */
	async communication() {

		if ((this.commPort != null) && (this.commParser != null)) {

			// port opened
			this.commPort.on('open', () => {

				// update connection state.
				this.setState('info.connection', true, true);

				this.commParser?.on('data', (data) => {
					this.log.info('Data' + data);
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