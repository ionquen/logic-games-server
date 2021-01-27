"use strict";
const { Console } = require('console')
const WebSocket = require('ws')
const Fs = require('fs')
const Https = require('https')
const Room = require('./components/room')
const {decodeToken, createToken} = require('./components/funcs')
//var heapdump = require('heapdump');

const PORT_CHAT = process.env.PORT || 8081
const PORT_LOBBY = process.env.PORT || 8082
const PORT_ROOM = process.env.PORT || 8083
console.log(`Ports: \n chat - ${PORT_LOBBY}\n chat - ${PORT_CHAT}\n chat - ${PORT_ROOM}`)
let rooms = []
let history = []

setInterval(() => {
	const mem = process.memoryUsage()
	console.log(`-----------------\nrss: ${mem.rss}\nheap: ${~~(mem.heapUsed/1024)}/${~~(mem.heapTotal/1024)} kb\nexternal: ${mem.external}\narrayBuffers: ${mem.arrayBuffers}\n-----------------`)
}, 10000)
setInterval(()=> {
	rooms.forEach((room, index)=> {
		if(room.users.every(player=>!player.connected?true:false)||!room.started&&((Date.now()-room.created)>300000)){
			room.close()
			rooms.splice(index, 1)
			console.log(`Закрыта комната ${room.roomId}`)
		}
	})
}, 60000)
function list(gameId) {
	let result = []
	rooms.forEach(room => room.gameId==gameId && room.private==false? result.push(room.info()): null)
	return result
}
function getroom(roomId) {
	for(let room of rooms) {
		if (room.roomId==roomId) return room
	}
}
//GLOBAL CHAT AND GENERATING TOKEN/////////////////////////////////////////////////////////////////////////////
const serverGlobalChat = Https.createServer({	
	key:Fs.readFileSync('/etc/letsencrypt/live/games-ws.ionquen.ru/privkey.pem'),
	cert:Fs.readFileSync('/etc/letsencrypt/live/games-ws.ionquen.ru/fullchain.pem')
	}).listen(PORT_CHAT, console.log(`Https chat running on port: ${PORT_CHAT}`))
const serverLobby = Https.createServer({
	key:Fs.readFileSync('/etc/letsencrypt/live/games-ws.ionquen.ru/privkey.pem'),
	cert:Fs.readFileSync('/etc/letsencrypt/live/games-ws.ionquen.ru/fullchain.pem')
	}).listen(PORT_LOBBY, console.log(`Https lobby running on port: ${PORT_LOBBY}`))
const serverRoom = Https.createServer({
	key:Fs.readFileSync('/etc/letsencrypt/live/games-ws.ionquen.ru/privkey.pem'),
	cert:Fs.readFileSync('/etc/letsencrypt/live/games-ws.ionquen.ru/fullchain.pem')
	}).listen(PORT_ROOM, console.log(`Https room running on port: ${PORT_ROOM}`))

const wssGlobalChat = new WebSocket.Server({server: serverGlobalChat});
wssGlobalChat.on('connection', ws => {
	ws.send(JSON.stringify({type: 'history', data: history}))

	ws.on('message', dataJSON => {
		try {
			const messageParsed = JSON.parse(dataJSON)
			const data = messageParsed.data
			switch (messageParsed.type) {

				case 'chat': 
					const formatMessage = {
							userName: data.userName,
							userId: decodeToken(data.token).userId,
							text: data.text,
							date: Date.now(),
					}
					wssGlobalChat.clients.forEach(client => {
						if(client != ws && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({type: 'chat', data: formatMessage}))					
					})
					if(history.length>19) history.shift()
					history.push(formatMessage)
					break
			}
			//console.log('G:  '+dataJSON)
		} catch {}
	})
	//ws.on('close', (e) => console.log('G: Connection lost. Code '+e))
})

//ПОЛУЧЕНИЕ ВСЕХ КОМНАТ/////////////////////////////////////////////////////////////////////////////
const wssLobby = new WebSocket.Server({server: serverLobby});
wssLobby.on("connection", ws => {
	let userId
	ws.on('message', dataJSON => {
		const messageParsed = JSON.parse(dataJSON)
		const data = messageParsed.data
		const wsSend = (type, data) => {
			ws.send(JSON.stringify({type: type, data: data}))
		}
		switch(messageParsed.type) {

			case 'list':{
				if(userId===undefined){
					if (data.token===null) {
						const newToken = createToken()
						userId = newToken.userId
						ws.send(JSON.stringify({type: 'token', data: newToken}))
					} else userId = decodeToken(data.token).userId
				}
				wsSend('list', list(data.gameId))
				break
			}
			case 'connectbyroomid': {
				const room = getroom(data)
				wsSend('connectbyroomid', room!==undefined?room.info():false)
				break
			}
			case 'create':
				try {
					const room = new Room({...data, creator: userId})
					rooms.push(room)
					wsSend('join', room.join(userId, data.pw, data.userName))
				} catch(e) {
					console.log(`Failed to create room. userId: ${userId}`)
					console.log(e)
				}
				break
			case 'join': {
				const room = getroom(data.roomId)
				wsSend('join', room!==undefined?room.join(userId, data.pw, data.userName):{roomId: null})//data=roomId
				break
			}
			case 'leave': 
				try {
					getroom(data).leave(userId)
				} catch {console.log(`Не удаётся покинуть комнату (возможно несуществующую). userId: ${userId}`)}
				break
			
		}
	})
	//ws.on('close', (e) => console.log('L: closed'))
})

//ROOM INTERACTIVE/////////////////////////////////////////////////////////////////////////////
const wssRoom = new WebSocket.Server({server: serverRoom});
wssRoom.on("connection", ws => {
	let user
	ws.on('message', dataJSON => {
		const messageParsed = JSON.parse(dataJSON)
		const data = messageParsed.data
		
		const wsSend = (type, data) => {
			ws.send(JSON.stringify({type: type, data: data}))
		}
		switch (messageParsed.type) {
			case 'connect': 
				if(user!==undefined) user.action('disconnect')
				const room = getroom(data.roomId)
				try{
					user = room.connect(decodeToken(data.token).userId, ws)
				} catch {console.log('connect error')}
				if (user!==undefined) wsSend('connect', {roomInfo: room.info(),...room.infoFull()})
				break
			case 'disconnect': 
				if(user!==undefined) {
					user.action('disconnect')
					user = undefined
				}
				break
				//Всё что связано с самой комнатой
			default: 
				if(user!==undefined) user.action(messageParsed.type, data)
				break
		}
	})
	ws.on('close', (e) => {
		if(user!==undefined) {
			user.action('disconnect')
			user=undefined
		}
	})
})