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
var crypto = require('crypto')
var events = require('events')
var fs = require('fs')
var http = require('http')
var path = require('path')
var util = require('util')

var jh = { 	
	config:{
		emitter:new events.EventEmitter(),
		filename:{
			dependency_xml:'dependency.xml',
			error_xml:'error.xml'
		},
		http_options:{  
			host:'search.maven.org',
			port:80, 	
		},
		max_errors:3,
		msg:{
			error_exit:'Encountered too many errors to continue.',
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
		recursive:false,
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
	state:{
		error_count:0,
		errors:[],
		error_log:null,
		dependency_log:null,		
	},
	error_counter:function(error){
		jh.state.errors.push(error)
		if(++jh.state.error_count == jh.config.max_errors){
			console.log(jh.config.msg.error_exit)
			jh.state.errors.forEach(function(e){
				console.log(util.format('\t%s',e))
			})
			process.exit()
		}
	},
	execute:function(dir){
		fs.readdir(dir, function(err, filenames){
				filenames.forEach(function(filename){					
					var qualified_filename = (dir ? (dir + '/') : '') + filename
					jh.filter(qualified_filename)
				})
			}
		)
		return jh			
	},
	filter:function(filename, index, list, regex){
		fs.stat(filename, function(error, stats){
			if(jh.config.recursive && stats.isDirectory()){
				jh.execute(filename)
			}else{
				if(filename.match(regex ? regex : /\.jar$/)){
					jh.generate_hash(filename)
				}
			}
		})
	},
	generate_hash:function(filename){
		fs.readFile(filename, function(err, data){
			var hash = crypto.createHash('sha1').update(data).digest('hex')
			if(jh.config.msg.found_jar){
				console.log(util.format(jh.config.msg.found_jar, filename, hash))
			}
			jh.config.emitter.emit('generate_url', filename, hash)
		})		
	},
	generate_url:function(filename, hash){
		var param = encodeURIComponent(util.format(jh.config.url.param_template, hash))
		jh.config.emitter.emit('search', filename, util.format(jh.config.url.template, param))
	},
	initialize:function(args){
		// cmd line args
		for(var i=0;i<args.length;i++){
			var arg = args[i]
			if('-r' == arg){
				jh.config.recursive = true
			}else if('-s' == arg){
				// suppress 'found' output
				jh.config.msg.found_jar = null
			}else if('-x' == arg && (args.length-1 > i)){
				// set dependency log filename
				fs.unlink(args[i+1])
				jh.state.dependency_log = fs.createWriteStream(args[i+1], {'flags': 'w'})
			}else if('-e' == arg && (args.length-1 > i)){
				// set error log filename
				fs.unlink(args[i+1])
				jh.state.error_log = fs.createWriteStream(args[i+1], {'flags': 'w'})			
			}	
		}
		
		// default filenames?
		if(!jh.state.error_log)			
			jh.state.error_log = fs.createWriteStream(jh.config.filename.error_xml, {'flags': 'w'})			
		if(!jh.state.dependency_log) 
			jh.state.dependency_log = fs.createWriteStream(jh.config.filename.dependency_xml, {'flags': 'w'})

		return this
	},
	register_events:function(emitter){
		// setup events
		emitter.on('generate_url', function(filename, hash){
			jh.generate_url(filename, hash)
		})
		emitter.on('search', function(filename, path){
			jh.search(filename, path)
		})
		emitter.on('error', function(error){
			jh.error_counter(error)
		})
		emitter.on('write_error_xml', function(error){
			jh.state.error_log.write(error)
		})
		emitter.on('write_dependency_xml', function(xml){
			jh.state.dependency_log.write(xml)
		})
		return this
	},
	search:function(filename, path){
		var options = {
			'host':jh.config.http_options.host,
			'port':jh.config.http_options.port,
			'path':path
		}
		http.get(options, function(res) {  
			res.on('data', function(chunk) {
				try{
					var obj = JSON.parse(chunk)
					jh.config.emitter.emit('write_dependency_xml', util.format(jh.config.xml.template, obj.response.docs[0].g, obj.response.docs[0].a, obj.response.docs[0].v))
				}catch(e){
					jh.config.emitter.emit('write_error_xml', util.format(jh.config.xml.error_template, filename, options.host, options.path))
				}
			})
		}).on('error', function(error) {			
			jh.config.emitter.emit('error',error)
		})		
	},
	validate_args:function(args, this_script, help_text){
		// validate parameter count		
		if(args[args.length-1] == this_script){
			jh.config.msg.help_text.forEach(function(text){
			 	console.log(text)
			})
			process.exit()
		}		
		
		// validate directory was supplied and that it exists
		if(path.existsSync(args[args.length-1])){
			var stat = fs.statSync(args[args.length-1])
			if(!stat.isDirectory()){
				console.log(util.format(jh.config.msg.validation_not_directory, args[args.length-1]))
				jh.config.emitter.emit('exit')
			}
		}else{
			console.log(util.format(jh.config.msg.validation_dir_ne, args[args.length-1]))
			jh.config.emitter.emit('exit')
		}
		return this
	}
}
jh
	.validate_args(process.argv, __filename, jh.config.msg.help_text)
	.initialize(process.argv)
	.register_events(jh.config.emitter)
	.execute(process.argv[process.argv.length-1])