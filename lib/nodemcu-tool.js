const _fs = require('fs');
const _nodeMcuConnector = require('./nodemcu-connector');
const _serialTerminal = require('./transport/serial-terminal');
const _path = require('path');
const _loggingFacility = require('logging-facility');

// NodeMCU-Tool Context Logger
const _logger = _loggingFacility.getLogger('NodeMCU-Tool');

// NodeMCU Context Logger
const _mculogger = _loggingFacility.getLogger('NodeMCU');

// Serial Terminal Context Logger
const _terminallogger = _loggingFacility.getLogger('SerialTerminal');

// output
let outputHandler = function(message){
    console.log(message);
};

let writeOutput = function(message){
    if (outputHandler){
        outputHandler(message);
    }
};

// global options
const _options = {
    // serial port baudrate
    baudrate: 115200,

    // serial device connected to nodemcu
    device: '/dev/ttyUSB0',

    // delay after opening the connection
    connectionDelay: 0
};

// helper function to create a NodeMCU Tool Connection
async function getConnection(){

    // create new connector
    try{
        const msg = await _nodeMcuConnector.connect(_options.device, _options.baudrate, true, _options.connectionDelay);

        // status message
        _logger.log('Connected');
        _mculogger.log(msg);

    }catch(e){
        _logger.error('Unable to establish connection');
        throw e;
    }
}

// show file-system info
async function fsinfo(format){

    // try to establish a connection to the module
    await getConnection();

    const {metadata, files} = await _nodeMcuConnector.fsinfo();

    // json output - third party applications
    if (format == 'json') {
        writeOutput(JSON.stringify({
            files: files,
            meta: metadata
        }));

    // raw format - suitable for use in bash scripts
    }else if (format == 'raw'){
        // print fileinfo
        files.forEach(function(file){
            writeOutput(file.name);
        });

    }else{
        _mculogger.log('Free Disk Space: ' + metadata.remaining + ' KB | Total: ' + metadata.total + ' KB | ' + files.length + ' Files');

        // files found ?
        if (files.length==0){
            _mculogger.log('No Files found - have you created the file-system?');
        }else{
            _mculogger.log('Files stored into Flash (SPIFFS)');

            // print fileinfo
            files.forEach(function(file){
                _mculogger.log(' - ' + file.name + ' (' + file.size + ' Bytes)');
            });
        }
    }
}
/*
// upload a local file to nodemcu
Tool.upload = function(localFiles, options, onProgess){

    // the index of the current uploaded file
    let fileUploadIndex = 0;

    const uploadFile = function(connector, localFile, remoteFilename, onComplete){

        // increment upload index
        fileUploadIndex++;

        // get file stats
        try{
            var fileInfo = _fs.statSync(localFile);
            
            // check if file is directory
            if (fileInfo.isDirectory()) {
                _mculogger.error('Path "' + localFile + '" is a directory.');
                onComplete();
                return;
            }

        // local file available
        } catch (err){
            _logger.error('Local file not found "' + localFile + '" skipping...');
            onComplete();
            return;
        }

        // display filename
        _logger.log('Uploading "' + localFile + '" >> "' + remoteFilename + '"...');

        // normalize the remote filename (strip relative parts)
        remoteFilename = remoteFilename.replace(/\.\.\//g, '').replace(/\.\./g, '').replace(/^\.\//, '');

        // delete old file (may existent)
        connector.removeFile(remoteFilename, function(err){

            // handle error
            if (err){
                connector.disconnect();
                _logger.error(err);
                return;
            }

            // start the file transfer
            connector.upload(localFile, remoteFilename, options,

                // onComplete
                function(err){

                    // handle error
                    if (err){
                        connector.disconnect();
                        _logger.error(err);
                        return;
                    }

                    // compile flag set ? and is a lua file ?
                    if (options.compile && _path.extname(localFile).toLowerCase() == '.lua'){
                        _mculogger.log(' |- compiling lua file..');

                        connector.compile(remoteFilename, function(error){
                            // success ? empty line will return (null)
                            if (error){
                                connector.disconnect();
                                _mculogger.error('Error: ' + error);
                            }else{
                                _mculogger.log(' |- success');

                                // drop original lua file
                                connector.removeFile(remoteFilename, function(error){

                                    if (error){
                                        connector.disconnect();
                                        _mculogger.error('Error: ' + error);
                                        return;
                                    }

                                    _mculogger.log(' |- original Lua file removed');
                                    onComplete();
                                });
                            }
                        });
                    }else{
                        // directly call complete handler
                        onComplete();
                    }
                },

                // on progress handler
                function(current, total){
                    // proxy and append file-number
                    onProgess(current, total, fileUploadIndex);
                }
            );
        });
    };

    // try to establish a connection to the module
    getConnection(function(connector){

        // single file upload ?
        if (localFiles.length == 1){
            // extract first element
            var localFile = localFiles[0];

            // filename defaults to original filename minus path.
            // this behaviour can be overridden by --keeppath and --remotename options
            var remoteFile = options.remotename ? options.remotename : (options.keeppath ? localFile : _path.basename(localFile));

            // start single file upload
            uploadFile(connector, localFile, remoteFile, function(){
                // close connection
                connector.disconnect();

                // log message
                _logger.log('File Transfer complete!');
            });

        // bulk upload ?
        }else{

            var uploadNext = function(){

                // file available ?
                if (localFiles.length > 0){

                    // extract file
                    var localFile = localFiles.shift();

                    // keep-path option set ?
                    var remoteFile = (options.keeppath ? localFile : _path.basename(localFile));

                    // trigger upload
                    uploadFile(connector, localFile, remoteFile, uploadNext);

                // no more file available
                }else{
                    // close connection
                    connector.disconnect();

                    // log message
                    _logger.log('Bulk File Transfer complete!');
                }
            };

            // trigger initial upload
            uploadNext();
        }
    });
};

// download a remote file from nodemcu
Tool.download = function(remoteFile){
    // strip path
    var localFilename = _path.basename(remoteFile);

    // local file with same name already available ?
    if (_fs.existsSync(remoteFile)){
        // change filename
        localFilename += '.' + (new Date().getTime());

        _logger.log('Local file "' + remoteFile + '" already exist - new file renamed to "' + localFilename + '"');
    }

    // try to establish a connection to the module
    getConnection(function(connector){
        _logger.log('Downloading "' + remoteFile + '" ...');

        connector.download(remoteFile,
            // onComplete
            function(err, filedata){
                // finished!
                connector.disconnect();

                if (err){
                    _logger.error('Data Transfer FAILED!');
                }else{
                    _logger.log('Data Transfer complete!');

                    // store local file
                    _fs.writeFileSync(localFilename, filedata);

                    _logger.log('File "' + localFilename + '" created');
                }
            }
        );
    });
};

// run a file on NodeMCU (.lc or .lua)
Tool.run = function(filename){

    // try to establish a connection to the module
    getConnection(function(connector){
        connector.run(filename, function(err, output){
            // finished!
            connector.disconnect();

            if (err){
                _mculogger.error(err);
            }else{
                // show command response
                _mculogger.log('Running "' + filename + '"');
                _mculogger.log('>----------------------------->');
                writeOutput(output);
                _mculogger.log('>----------------------------->');
            }
        });
    });
};

// removes a file from NodeMCU
Tool.remove = function(filename){

    // try to establish a connection to the module
    getConnection(function(connector){
        connector.removeFile(filename, function(err){
            // finished!
            connector.disconnect();

            if (err){
                _mculogger.error(err);
            }else{
                // just show complete message (no feedback from nodemcu)
                _mculogger.log('File "' + filename + '" removed!');
            }
        });
    });
};

// format the file system
Tool.mkfs = function(){

    // try to establish a connection to the module
    getConnection(function(connector){

        _mculogger.log('Formatting the file system...this will take around ~30s');

        connector.format(function(err, response){
            // finished!
            connector.disconnect();

            if (err){
                _mculogger.error('Formatting failed - ' + err);
            }else{
                // just show complete message
                _mculogger.log('File System created | ' + response);
            }
        });
    });
};

*/

// Reset of the NodeMCU Module
async function softreset(){

    // try to establish a connection to the module
    await getConnection();

    // trigger softeset
    await _nodeMcuConnector.softreset();

    // log
    _mculogger.log('Soft-Reset executed (node.restart())');
}

// Reset of the NodeMCU Module
// @TODO reset without connection check!!!!
async function hardreset(){

    // try to establish a connection to the module
    await getConnection();

    // trigger softeset
    await _nodeMcuConnector.hardreset();

    // log
    _mculogger.log('Hard-Reset executed (100ms)');
}


/*
// serial terminal <> console session
function terminal(initialCommand){
    // create new connector
    var terminal = new _serialTerminal();

    _terminallogger.log('Starting Terminal Mode - press ctrl+c to exit');

    // run initial command before starting terminal session ?
    if (initialCommand){
        terminal.onConnect(function(device){
            device.write(initialCommand + '\n');
        });
    }

    // start
    terminal.passthrough(_options.device, _options.baudrate, function(err){
        if (err){
            _terminallogger.error(err);
        }else{
            _terminallogger.log('Connection closed');
        }
    });
};
*/

// show serial devices connected to the system
async function devices(showAll, jsonOutput){

    // try to establish a connection to the module
    await getConnection();
    
    try{
        const serialDevices = await _nodeMcuConnector.listDevices();

        if (jsonOutput){
            writeOutput(JSON.stringify(devices));
        }else{
            // just show complete message
            if (serialDevices.length == 0){
                _mculogger.error('No Connected Devices found | Total: ' + serialDevices.length);

            }else{
                _mculogger.log('Connected Devices | Total: ' + serialDevices.length);
    
                // print fileinfo
                serialDevices.forEach(function(device){
                    _mculogger.log('- ' + device.comName + ' (' + device.manufacturer + ', ' + device.pnpId + ')');
                });
            }
        }
    }catch(e){
        _mculogger.alert('Cannot retrieve serial device list - ' + e);
    }
}

// Programmatic Access to the core functions
module.exports = {
    // access the connector directly
    Connector: _nodeMcuConnector,

    // set output handler
    onOutput: function (handler) {
        outputHandler = handler;
    },

    // set connector options
    setOptions: function(opt){
        // merge with default options
        Object.keys(_options).forEach(function(key){
            _options[key] = opt[key] || _options[key];
        });
    },

    // cli-commmands
    devices: devices,
    fsinfo: fsinfo,
    softreset: softreset,
    hardreset: hardreset
};