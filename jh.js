#!/usr/bin/env node
/*
jar-hunt, version 1.0.3

jh.js will generate <dependency> XML fragments for a directory of jar-files to be used in Maven pom.xml file.
This XML fragment is created by recursively searching the specified directory for jar-files,
generating a SHA-1 hash value for each encountered jar-file which is then used to search the Maven Central Repository.

Useful for assessing name and version of directories of vaguely named jar files.

usage:
	node jh.js [-s -x $filename -e $filename] $directory_that_contains_jars

	-e $filename to write error output, default is, "error.xml"
	-r recursively search for jar-files
	-s suppress "found" messages
	-x $filename to write xml output, default is, "dependency.xml"


Thanks to Sonatype, Inc. for hosting central repository jar and look-up service (search.maven.org)
This program is not endorsed, owned by nor affiliated with Sonatype, Inc.

+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-
Copyright 2012 Matthew David Huckaby

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-
*/

var jarhunt_context = {
  "configInstance": function () {
    return {
      "console": console,
      "emitter": null,
      "filenames": {
        "dependency_xml": "dependency.xml",
        "error_xml": "error.xml",
        "this_script": __filename
      },

      "http_options": {
        "host": "search.maven.org",
        "port": 80
      },

      "logger": {
        "error": null,
        "info": null
      },

      "msgs": {
        "found_jar": "found \t: %s\nhash \t: %s",
        "help_text": ['jar-hunt, v.1.0.3',
          'usage:',
          '\t[node] jh.js [-e {filename} -r -s -x {filename}] {directory_that_contains_jars}\n',
          '\t-e ${filename} to write error output, default is, "error.xml"',
          '\t-r recursively search for jar-files',
          '\t-s suppress "found" messages',
          '\t-x ${filename} to write xml output, default is, "dependency.xml"'],
        "validation_not_directory": "argument, \"%s\" is not a directory:",
        "validation_dir_ne": "directory, \"%s\" does not exist."
      },

      "process": process,
      "recursive": false,
      "requires": {
        "crypto": require('crypto'),
        "events": require('events'),
        "fs": require('fs'),
        "http": require('http'),
        "path": require('path'),
        "util": require('util'),
        "process": process
      },

      "url": {
        "param_template": ":\"%s\"",
        "template": "/solrsearch/select?q=1%s&rows=20&wt=json"
      },

      "xml": {
        "error_template": "<error\nfile=\"%s\"\nurl=\"%s%s\" />\n",
        "template":
          "<dependency>\n" +
          "\t<groupId>%s</groupId>\n" +
          "\t<artifactId>%s</artifactId>\n" +
          "\t<version>%s</version>\n" +
          "</dependency>\n"
      }
    };
  },

  "jarHuntInstance": function (config) {
    config = config || this.configInstance();
    var initialize = {
      "handle_cmd_line_arguments": function() {

        var find_next_arg = function(i) {
          return config.process.argv.length-1 > i ? config.process.argv[i+1] : null;
        };

        var unlinkCallback = function() {}

        // cmd line arguments
        for(var i=0;i<config.process.argv.length;i++) {
          var arg = config.process.argv[i];
          var next_arg = find_next_arg(i);

          if('-e' === arg && next_arg) {
            // set error log filename
            config.requires.fs.unlink(next_arg, unlinkCallback);
            config.logger.error =
              config.requires.fs.createWriteStream(next_arg, {"flags": "w"});
          }else if('-r' === arg) {
            config.recursive = true;
          }else if('-s' === arg) {
            // suppress 'found' output
            config.msgs.found_jar = null;
          }else if('-x' === arg && next_arg) {
            // set dependency log filename
            config.requires.fs.unlink(next_arg, unlinkCallback);
            config.logger.info =
                config.requires.fs.createWriteStream(next_arg, {"flags": "w"});
          }
        }

        config.emitter = new config.requires.events.EventEmitter();
        return this;
      },

      "register_events": function(emitter) {

        emitter.on('execute', function(dir, config) {
          dir = dir ? dir : config.process.argv[config.process.argv.length-1];
          config.requires.fs.readdir(dir, function(err, filenames) {
            if(filenames) {
              filenames.forEach(function(filename) {
                var qualified_filename = (dir ? (dir + '/') : '') + filename;
                config.emitter.emit('filter', qualified_filename, config);
              });
            }else{
              config.console.log('no files found : ' + dir);
            }
          })
        });

        emitter.on('filter', function(filename, config) {
          config.requires.fs.stat(filename, function(error, stats) {
            if(config.recursive && stats.isDirectory()) {
              config.emitter.emit('execute', filename, config);
            }else{
              if(filename.match(/\.jar$/)) {
                config.emitter.emit('queue', filename, config);
              }
            }
          })
        });

        var queue;
        emitter.on('queue', function(filename, config) {
          if(queue) {
            queue.push(filename);
          }else{
            // first
            queue = [];
            emitter.emit('generate_hash_asynch', filename, config, function() {
              emitter.emit('chew-queue', config);
            })
          }
        });

        emitter.on('chew-queue', function(config) {
          if(queue.length) {
            emitter.emit('generate_hash_asynch', queue.pop(), config, function() {
              emitter.emit('chew-queue', config);
            })
          }
        });

        emitter.on('generate_hash_asynch', function(filename, config, post_read_callback) {
          config.requires.fs.readFile(filename, function(err, data) {
            post_read_callback(); // emfile error is avoided

            var hash = config.requires.crypto.createHash('sha1').update(data).digest('hex');

            if(config.msgs.found_jar) {
              config.console.log(config.requires.util.format(config.msgs.found_jar, filename, hash));
            }

            config.emitter.emit('generate_url', filename, hash, config);
          })
        });

        emitter.on('generate_url', function(filename, hash, config) {
          var param = encodeURIComponent(config.requires.util.format(config.url.param_template, hash));
          config.emitter.emit('search', filename, config.requires.util.format(config.url.template, param), config);
        });

        emitter.on('search', function(filename, path, config) {
          var options = {
            "host": config.http_options.host,
            "port": config.http_options.port,
            "path": path
          };

          config.requires.http.get(options, function(res) {
            res.on('data', function(chunk) {
              try{
                var obj = JSON.parse(chunk);
                var value =
                    config.requires.util.format(
                        config.xml.template,
                        obj.response.docs[0].g,
                        obj.response.docs[0].a,
                        obj.response.docs[0].v
                    );
                config.emitter.emit('write_dependency_xml', value, config);
              }catch(e) {
                var error_message =
                    config.requires.util.format(
                        config.xml.error_template,
                        filename,
                        options.host,
                        options.path
                    );
                config.emitter.emit('write_error_xml', error_message, config);
              }
            })
          }).on('error', function(error) {
            config.console.log(error);
            config.process.exit();
          })
        });

        emitter.on('write_dependency_xml', function(xml, config) {
          if(!config.logger.info)
            config.logger.info = config.requires.fs.createWriteStream(config.filenames.dependency_xml, {'flags': 'w'});

          config.logger.info.write(xml);
        });

        emitter.on('write_error_xml', function(error, config) {
          if(!config.logger.error)
            config.logger.error = config.requires.fs.createWriteStream(config.filenames.error_xml, {'flags': 'w'});

          config.logger.error.write(error);
        });

        return this
      },

      "validate_args": function() {
        var last_arg = config.process.argv[config.process.argv.length-1];

        // validate parameter count
        if(last_arg === config.filenames.this_script) {
          config.msgs.help_text.forEach(function(text) {
             config.console.log(text);
          });

          config.process.exit();
        }

        // validate directory was supplied and that it exists
        if(config.requires.fs.existsSync(last_arg)) {
          var stat = config.requires.fs.statSync(last_arg);
          if(!stat.isDirectory()) {
            config.console.log(config.requires.util.format(config.msgs.validation_not_directory, last_arg));
            config.requires.process.exit();
          }
        }else{
          config.console.log(config.requires.util.format(config.msgs.validation_dir_ne, last_arg));
          config.process.exit();
        }

        return this;
      }

    };

    return {
      "execute": function() {
        initialize
          .validate_args()
          .handle_cmd_line_arguments()
          .register_events(config.emitter);

        config.emitter.emit('execute', null, config);
      }
    };

  }
};

(function() {
  jarhunt_context
    .jarHuntInstance(jarhunt_context.configInstance()).execute();
})();
