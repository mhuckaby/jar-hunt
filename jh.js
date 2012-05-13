#!/usr/local/bin/node
/*
jar-hunt

jh.js will generate <dependency> XML fragments for a directory of jar-files to be used in Maven pom.xml file.
This XML fragment is created by recursively searching the specified directory for jar-files,
generating a SHA-1 hash value for each encountered jar-file which is then used to search the Maven Central Repository.

Useful for assessing name and version of directories of vaguely named jar files.

usage:
	node jh.js [-s -x $filename -e $filename] ${directory_that_contains_jars}
	
	-e ${filename} to write error output, default is, "error.xml"
	-r recursively search for jar-files
	-s suppress "found" messages
	-x ${filename} to write xml output, default is, "dependency.xml"


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
var jh = { 	
	config:{
		console:console,
		emitter:null,
		filenames:{
			dependency_xml:'dependency.xml',
			error_xml:'error.xml',
			this_script:__filename
		},
		http_options:{  
			host:'search.maven.org',
			port:80, 	
		},
		logger:{
			error:null,
			info:null
		},		
		msgs:{
			found_jar:'found, "%s", hash(sha1)=%s',
			help_text:['jar-hunt, v.1.0.0b', 
				'usage:', 
				'\t[node] jh.js [-s -x $filename -e $filename] ${directory_that_contains_jars}\n',
				'\t-e ${filename} to write error output, default is, "error.xml"',
				'\t-r recursively search for jar-files',
				'\t-s suppress "found" messages',
				'\t-x ${filename} to write xml output, default is, "dependency.xml"',				
				],			
			validation_not_directory:'argument, "%s" is not a directory',
			validation_dir_ne:'directory, "%s" does not exist.'
		},
		process:process,
		recursive:false,
		requires:{
			crypto:require('crypto'),
			events:require('events'),
			fs:require('fs'),
			http:require('http'),
			path:require('path'),
			util:require('util')			
		},
		url:{
			param_template:':"%s"',
			template:'/solrsearch/select?q=1%s&rows=20&wt=json'
		},
		xml:{
			error_template:'<error\nfile="%s"\nurl="%s%s" />\n',
			template:
				'<dependency>\n' +
				'\t<groupId>%s</groupId>\n' +
				'\t<artifactId>%s</artifactId>\n' +
				'\t<version>%s</version>\n' +
				'</dependency>\n'
		}
	},
	execute:function(dir, config){
		var dir = dir ? dir : config.process.argv[config.process.argv.length-1]
		config.requires.fs.readdir(dir, function(err, filenames){
				filenames.forEach(function(filename){					
					var qualified_filename = (dir ? (dir + '/') : '') + filename
					config.emitter.emit('filter', qualified_filename, config)
				})
			}
		)
		return jh			
	},
	filter:function(filename, config){
		config.requires.fs.stat(filename, function(error, stats){
			if(config.recursive && stats.isDirectory()){
				config.emitter.emit('execute_on_dir', filename, config)
			}else{
				if(filename.match(/\.jar$/)){
					config.emitter.emit('generate_hash', filename, config)
				}
			}
		})
	},
	generate_hash:function(filename, config){
		config.requires.fs.readFile(filename, function(err, data){
			var hash = config.requires.crypto.createHash('sha1').update(data).digest('hex')
			if(config.msgs.found_jar){
				config.console.log(config.requires.util.format(config.msgs.found_jar, filename, hash))
			}
			config.emitter.emit('generate_url', filename, hash, config)
		})		
	},
	generate_url:function(filename, hash, config){
		var param = encodeURIComponent(config.requires.util.format(jh.config.url.param_template, hash))
		config.emitter.emit('search', filename, config.requires.util.format(jh.config.url.template, param), config)
	},
	initialize:function(config){
		// cmd line args
		for(var i=0;i<config.process.argv.length;i++){
			var arg = config.process.argv[i]
			if('-r' == arg){
				config.recursive = true
			}else if('-s' == arg){
				// suppress 'found' output
				config.msgs.found_jar = null
			}else if('-x' == arg && (config.process.argv.length-1 > i)){
				// set dependency log filename
				config.requires.fs.unlink(config.process.argv[i+1])
				config.logger.info = config.fs.createWriteStream(args[i+1], {'flags': 'w'})
			}else if('-e' == arg && (config.process.argv.length-1 > i)){
				// set error log filename
				config.requires.fs.unlink(config.process.argv[i+1])
				config.logger.error = fs.createWriteStream(config.process.argv[i+1], {'flags': 'w'})
			}	
		}
		config.emitter = new config.requires.events.EventEmitter();
		return this
	},
	register_events:function(emitter){
		// setup events
		emitter.on('execute_on_dir', function(filename, config){
			jh.execute(filename, config)
		})
		emitter.on('filter', function(qualified_filename, config){
			jh.filter(qualified_filename, config)
		})
		emitter.on('generate_hash', function(filename, config){
			jh.generate_hash(filename, config)
		})
		emitter.on('generate_url', function(filename, hash, config){
			jh.generate_url(filename, hash, config)
		})
		emitter.on('search', function(filename, path, config){
			jh.search(filename, path, config)
		})
		emitter.on('write_dependency_xml', function(xml, config){
			config.logger.info.write(xml)
		})
		emitter.on('write_error_xml', function(error, config){
			config.logger.error.write(error)
		})
		return this
	},
	search:function(filename, path, config){
		var options = {
			'host':config.http_options.host,
			'port':config.http_options.port,
			'path':path
		}
		config.requires.http.get(options, function(res) {  
			res.on('data', function(chunk) {
				try{
					var obj = JSON.parse(chunk)
					var value = config.requires.util.format(config.xml.template, obj.response.docs[0].g, obj.response.docs[0].a, obj.response.docs[0].v)
					config.emitter.emit('write_dependency_xml', value, config)
				}catch(e){
					var value = config.requires.util.format(config.xml.error_template, filename, options.host, options.path)
					config.emitter.emit('write_error_xml', value, config)
				}
			})
		}).on('error', function(error) {			
			config.console.log(error)
			config.process.exit()
		})		
	},
	validate_args:function(config){
		var last_arg = config.process.argv[config.process.argv.length-1]	
		
		// validate parameter count	
		if(last_arg == config.filenames.this_script){
			config.msgs.help_text.forEach(function(text){
			 	config.console.log(text)
			})
			config.process.exit()
		}
		
		// validate directory was supplied and that it exists
		if(config.requires.path.existsSync(last_arg)){
			var stat = config.requires.fs.statSync(last_arg)
			if(!stat.isDirectory()){
				config.console.log(config.requires.util.format(config.msgs.validation_not_directory, last_arg))
				config.requires.process.exit()
			}
		}else{
			config.console.log(config.requires.util.format(config.msgs.validation_dir_ne, last_arg))
			config.requires.process.exit()
		}
		return this
	},
	validate_loggers:function(config){
		// default filenames?
		if(!config.logger.error)
			config.logger.error = config.requires.fs.createWriteStream(jh.config.filenames.error_xml, {'flags': 'w'})
		if(!config.logger.info) 
			config.logger.info = config.requires.fs.createWriteStream(jh.config.filenames.dependency_xml, {'flags': 'w'})			
		return this	
	}
}

jh
	.validate_args(jh.config)
	.initialize(jh.config)
	.validate_loggers(jh.config)
	.register_events(jh.config.emitter)
	.execute(null, jh.config)