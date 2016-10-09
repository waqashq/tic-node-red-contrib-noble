/*
 * Copyright (c) 2014. Knowledge Media Institute - The Open University
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * NodeRed node with support for interaction with BLEs
 *
 * @author <a href="mailto:carlos.pedrinaci@open.ac.uk">Carlos Pedrinaci</a> (KMi - The Open University)
 * based on the initial node by Charalampos Doukas http://blog.buildinginternetofthings.com/2013/10/12/using-node-red-to-scan-for-ble-devices/
 */
module.exports = function(RED) {
    "use strict";

    var noble = require('noble');
    var os = require('os');

    // The main node definition - most things happen in here
    function NobleScan(n) {
        // Create a RED node
        RED.nodes.createNode(this,n);

        // Store local copies of the node configuration (as defined in the .html)
        this.duplicates = n.duplicates;
        this.uuids = [];
        if (n.uuids != undefined && n.uuids !== "") {
            this.uuids = n.uuids.split(',');    //obtain array of uuids
        }
        if(n.interval != undefined && n.interval !== "")
            this.tic_interval = n.interval;
        else 
            this.tic_interval = 0x0010
        if(n.window != undefined && n.window !== "")
            this.tic_window = n.window;
        else 
            this.tic_window = 0x0010

        var node = this;
        var machineId = os.hostname();
        var scanning = false;

        noble.on('discover', function(peripheral) {
            var msg = { payload:{peripheralUuid:peripheral.uuid, localName: peripheral.advertisement.localName} };
            msg.peripheralUuid = peripheral.uuid;
            msg.localName = peripheral.advertisement.localName;
            msg.detectedAt = new Date().getTime();
            msg.detectedBy = machineId;
            msg.advertisement = peripheral.advertisement;
            msg.rssi = peripheral.rssi;

            // Check the BLE follows iBeacon spec
            if (peripheral.manufacturerData) {
                // http://www.theregister.co.uk/2013/11/29/feature_diy_apple_ibeacons/
                if (peripheral.manufacturerData.length >= 25) {
                    var proxUuid = peripheral.manufacturerData.slice(4, 20).toString('hex');
                    var major = peripheral.manufacturerData.readUInt16BE(20);
                    var minor = peripheral.manufacturerData.readUInt16BE(22);
                    var measuredPower = peripheral.manufacturerData.readInt8(24);

                    var accuracy = Math.pow(12.0, 1.5 * ((rssi / measuredPower) - 1));
                    var proximity = null;

                    if (accuracy < 0) {
                        proximity = 'unknown';
                    } else if (accuracy < 0.5) {
                        proximity = 'immediate';
                    } else if (accuracy < 4.0) {
                        proximity = 'near';
                    } else {
                        proximity = 'far';
                    }

                    msg.manufacturerUuid = proxUuid;
                    msg.major = major;
                    msg.minor = minor;
                    msg.measuredPower = measuredPower;
                    msg.accuracy = accuracy;
                    msg.proximity = proximity;
                }
            }

            // Generate output event
            node.send(msg);
        });


        function restartScan(stateChange, error, interval2) {
            if (node.scanning) {
                stopScan(false, false);
                // send status message
                var msg = {
                    statusUpdate: true,
                    error: error,
                    stateChange: stateChange,
                    state: noble.state
                };
                node.send(msg);
                // start the scan
                noble.startScanning(node.uuids, node.duplicates, interval2, node.tic_window, function() {
                    node.log("Scanning for BLEs started. UUIDs: " + node.uuids + " - Duplicates allowed: " + node.duplicates);
                    node.status({fill:"green",shape:"dot",text:"started"});
                    node.scanning = true;
                });
            }
        }

        // Take care of starting the scan and sending the status message
        function startScan(stateChange, error, interval2) {
            if (!node.scanning) {
                // send status message
                var msg = {
                    statusUpdate: true,
                    error: error,
                    stateChange: stateChange,
                    state: noble.state
                };
                node.send(msg);
                // start the scan
                noble.startScanning(node.uuids, node.duplicates, interval2, node.tic_window, function() {
                    node.log("Scanning for BLEs started. UUIDs: " + node.uuids + " - Duplicates allowed: " + node.duplicates);
                    node.status({fill:"green",shape:"dot",text:"started"});
                    node.scanning = true;
                });
            }
        }

        // Take care of stopping the scan and sending the status message
        function stopScan(stateChange, error) {
            if (node.scanning) {
                // send status message
                var msg = {
                    statusUpdate: true,
                    error: error,
                    stateChange: stateChange,
                    state: noble.state
                };
                node.send(msg);
                // stop the scan
                noble.stopScanning(function() {
                    node.log('BLE scanning stopped.');
                    node.status({fill:"red",shape:"ring",text:"stopped"});
                    node.scanning = false;
                });
                if (error) {
                    node.warn('BLE scanning stopped due to change in adapter state.');
                }
            }
        }

        // deal with state changes
        noble.on('stateChange', function(state) {
            if (state === 'poweredOn') {
                startScan(true, false, 0x0010);
            } else {
                if (node.scanning) {
                    stopScan(true, true);
                }
            }
        });

        // start initially
        if (noble.state === 'poweredOn') {
            startScan(false, false, 0x0010);
        } else {
            // send status message
            var msg = {
                statusUpdate: true,
                error: true,
                stateChange: false,
                state: noble.state
            };

            // TODO: Catch a global event instead eventually
            setTimeout(function(){
                node.send(msg);
            }, 3000);

            node.warn('Unable to start BLE scan. Adapter state: ' + noble.state);
        }

        var first = true;
        // control scanning
        node.on('input', function (msg) {
            if (msg.hasOwnProperty("payload") && typeof msg.payload == "object" && msg.payload.hasOwnProperty("scan")) {
                if (msg.payload.scan === true) {
                    if(!first && node.scanning)
                        restartScan(false, false, msg.payload.interval);
                    else{
                        startScan(false, false, msg.payload.interval);
                        first = false;
                    }
                    return;
                } else if (msg.payload.scan === false) {
                    stopScan(false, false);
                    return;
                }
            }
            node.warn("Incorrect input, ignoring. See the documentation in the info tab. ");
        });

    
        node.on("close", function() {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: this.client.disconnect();
            stopScan(false, false);
            // remove listeners since they get added again on deploy
            noble.removeAllListeners();
        });

    }
    
    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("scan ble",NobleScan);

}