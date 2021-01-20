"use strict";
const { Console } = require('console')
const WebSocket = require('ws')
const Crypto = require('crypto')
const Fs = require('fs')
const Https = require('https')
const Http = require('http')
//var heapdump = require('heapdump');
const PORT_CHAT = process.env.PORT || 8081
const PORT_LOBBY = process.env.PORT || 8082
const PORT_ROOM = process.env.PORT || 8083
console.log(`Ports: \n chat - ${PORT_LOBBY}\n chat - ${PORT_CHAT}\n chat - ${PORT_ROOM}`)
let lastUserId = Fs.readFileSync("properties.txt", {flag: "a+"});
if (lastUserId=='') lastUserId=1
lastUserId=+lastUserId
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
function createToken() {
	lastUserId++ 
	const userId = lastUserId
	const fssProperties = Fs.createWriteStream('properties.txt')
	fssProperties.write(lastUserId.toString())
	fssProperties.end()
	const encodedToken = lastUserId.toString() + '#' + Date.now().toString()
	const cipher = Crypto.createCipher('aes-256-cbc', "mnfui43hf897fh3847hf7uhvolow87ny874")
	let newToken = cipher.update(encodedToken , 'utf8', 'hex')
	newToken += cipher.final('hex')
	return {token: newToken, userId: userId}
}
function decodeToken(token) {
	const decipher = Crypto.createDecipher('aes-256-cbc', "mnfui43hf897fh3847hf7uhvolow87ny874")
	let deci = decipher.update(token, 'hex', 'utf8')
	deci +=decipher.final('utf8')
	const userId = +(deci).match(/^.+(?=\#)/)
	const tokenDateCreated = +(deci).match(/(?=\#).+$/)
	return {userId: userId, date: tokenDateCreated}
}
function randomMath() {
	const random = () => {
		return Math.random().toString(36).substr(2)
	}
	return random()
}
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
				} catch {console.log(`Не удалось создать комнату. userId: ${userId}`)}
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

class Room {
	constructor(data) {
		this.created = Date.now() //Дата пересоздания лобби
		this.creator = data.creator||1 //userId создателя комнаты
		this.roomId = randomMath().match(/^.{6}/)[0] //Случайный roomId
		this.name = data.name||"Безымянная комната" //Название
		this.private = data.private||false //Приватность комнаты
		this.max = data.gameProps.max||2 //Максимальное число игроков
		this.autostart = data.autostart||true //Автостарт при максимальном числе игроков
		this.gameId = data.gameId||"tictactoe" //Название игры
		this.usePw = data.usePw||false //Подключение по паролю
		if (data.usePw==true) this.pw = data.pw //Пароль в комнату
		this.users = [] //Массив игроков
		this.started = false //Игра началась
		
		this.gameProps = data.gameProps //Внутриигровые свойства
		this.chat = []
		this.gameObj = undefined //Объект игры
	}

	info() {
		let result = {
			roomId: this.roomId, 
			gameId: this.gameId, 
			created: this.created, 
			creator: this.creator,
			name: this.name, 
			max: this.max, 
			usePw: this.usePw,
			autostart: this.autostart,
			started: this.started,
			users: [],
		}
		this.users.forEach(user => result.users.push({userId: user.userId, userName: user.userName, leave: user.leave, connected: user.connected}))
		return result
	}

	infoFull() {
		return {
			chat: this.chat,
			gameInfo: this.started?this.gameObj.info():undefined,
		}
	}

	//Провоцирует рестарт комнаты (вызывается после завершения игры)
	restartRoom = () => {
		this.gameObj = undefined
		setTimeout(() => {
			this.started = false
			this.created = Date.now()
			this.users.forEach(user => !user.leave?user.serverAction('finished'):this.leave(user.userId))
		}, 3000)
	}

	start(userId) {
		if (this.started===true||this.creator!==userId&&userId!==undefined) return false
		try {
			switch (this.gameId) {
				case "tictactoe": this.gameObj = new Tictactoe(this.gameProps, this.users, this.restartRoom); break
				case "minesweeper": this.gameObj = new Minesweeper(this.gameProps, this.users, this.restartRoom); break
				default: break
			}
			this.users.forEach(user => user.serverAction('start', this.gameObj.info(user.userId)))
			this.started = true
		}
		catch (e) {console.log('Не удалось начать игру')}
	}

	action = (userId, type, data) => {
		switch (type) {
			case "start": this.start(userId)
				break;
			case "game": 
				if (this.gameObj!==undefined) this.gameObj.action(userId, data)
				break;
			case "chat": 
				if(this.chat.length>19) this.chat.shift()
				const formatMessage = {
					userName: data.userName,
					userId: decodeToken(data.token).userId,
					text: data.text,
					date: Date.now(),
				}
				this.chat.push(formatMessage)
				this.users.forEach(user => user.userId!==userId?user.serverAction('chat', formatMessage):null)
				break;
			case "disconnect":
				this.users.forEach(user => user.userId!==userId?user.serverAction('userDisconnected', userId):user.connected=false)
				break; 
		}
	}

	join = (userId, pw, userName) => {
		if(this.users.length == this.max || this.started || this.users.some(user => user.userId==userId?true:false)) return false
		if(this.usePw && this.pw!=pw) return false
		this.users.forEach(user => user.serverAction('userJoin', {userId: userId, userName: userName, leave: false}))
		const newUser = new User(userId, userName)
		newUser.userAction = this.action
		this.users.push(newUser)
		//if (this.autostart) this.start()
		return this.roomId
	}

	leave(userId) {
		this.users.forEach((user, index) => {
			if(user.userId==userId) {
				if (this.started) {
					user.leave = true
				} else {
					this.users.splice(index, 1)
					if (this.users.length==0) rooms.forEach((room, index) => room.roomId===this.roomId?rooms.splice(index, 1):null)
				}
			} 
		})
		this.users.forEach(user => user.serverAction('userLeave', userId))
		return true
	}
	
	connect(userId, ws) {
		for(let user of this.users) {
				if (user.userId===userId && !user.leave) {
					user.connected = true
					user.serverAction = (type, data) => {
						if (user.connected) ws.send(JSON.stringify({type: type, data: data}))
					}
					this.users.forEach(user => user.userId!==userId?user.serverAction('userConnected', userId):null)
					return user
				}
		}
	}
	close() {
		console.log('room closed')
		if (this.gameObj) this.gameObj.finish()
	}

}

class User {
	connected = true
	leave = false
	serverAction = undefined
	userAction = undefined

	constructor(userId, userName="Player 1") {
		this.userId = userId
		this.userName = userName
	}
	action(type, data) {
		this.userAction(this.userId, type, data)
	}
}

class Tictactoe {
	constructor(props={}, users, restartRoom) {
		if (users.length<2||users.length>3) throw 0
		//Время на ход
		this.timeTurn = props.timeTurn||20000 
		//Количество раундов для победы игрока
		this.roundsForWin = props.roundsForWin||10 
		//Размер поля
		this.boardSize = props.boardSize||19 
		//Количество ячеек в ряд для победы
		this.cellsForWin = props.cellsForWin&&props.boardSize>=props.cellsForWin?props.cellsForWin:5 
		//Последовательность, в которой игроки совершают ход
		this.queue = [] 
		//Игрок, который должен ходить (по массиву queue)
		this.currentPlayerTurn = 0 
		//Текущий счёт
		this.score = {} 
		//Текущие данные поля
		this.currentBoard = {} 
		//Timestamp последнего события 
		this.lasttime = undefined 
		//Игра приостановлена (между раундами или в конце игры)
		this.paused = true 

		//Перезагрузить комнату для новой партии
		this.restartRoom = restartRoom 
		//Содержит setInterval
		this.interval = undefined
		//Сведения об игроках из users
		this.players = users 

		//Рандомим последовательность хода
		let setupQueue = 0
		while (setupQueue<this.players.length) {
			const randomQueue = Math.floor(Math.random()*this.players.length)
			if (this.queue[randomQueue]===undefined) {
				this.queue[randomQueue] = setupQueue
				setupQueue++
			}
		}
		for(let i = 0; i < this.players.length; i++) {
			this.score[i]=[0]
		}

		//Запускаем
		this.interval = setInterval(() => this.checkPlayerTimer(), 1000)
		setTimeout(this.startNewRound, 1000)
	}

	
	/*
		Events
			nextPlayer - пропуск хода текущего игрока ex: {nextPlayer: (след .игрок), lasttime: (timestamp)}
			roundStarted - начало раунда ex: {currentPlayerTurn: (след. игрок), lasttime: (timestamp)}
			roundFinished, turn - завершение раунда / ход игрока 
				ex: {x: (x), y: (y), cell: (номер игрока), lasttime:(timestamp), nextPlayer: (след. игрок)}
			error - ячейка уже занята (из-за бага) ex: {x: (x), y: (y), cell: (номер игрока)}
			matchFinished - завершение матча ex: {currentPlayerTurn: (победитель)}
	*/


	info(userId) {
		return {
			timeTurn: this.timeTurn,
			roundsForWin: this.roundsForWin,
			boardSize: this.boardSize,
			cellsForWin: this.cellsForWin,
			queue: this.queue,
			
			currentBoard: this.currentBoard,
			currentPlayerTurn: this.currentPlayerTurn,
			lasttime: this.lasttime,
			paused: this.paused,
			score: this.score,
		}
	}
	//Получить текущего игрока
	currentUser = () => this.players[this.queue[this.currentPlayerTurn]]

	checkPlayerTimer(){
		console.log(this.currentPlayerTurn)
		if(!this.paused&&Date.now()>this.timeTurn+this.lasttime||this.currentUser().leave) {
			this.lasttime = Date.now()
			const nextPlayer = this.nextPlayer()
			if(nextPlayer!==null) {
				this.players.forEach(user => !user.connected?null:user.serverAction('game', {
					type: 'nextPlayer',
					nextPlayer: nextPlayer,
					lasttime: this.lasttime,
				}))
				this.currentPlayerTurn = nextPlayer
			} else this.finish()
		}
	}
	
	startNewRound = () => {
		this.lasttime = Date.now()
		this.paused = false
		this.currentBoard = {}
		this.players.forEach(user => user.serverAction('game', {
			type: 'roundStarted',
			currentPlayerTurn: this.currentPlayerTurn,
			lasttime: this.lasttime,
		}))
	}
	
	action(userId, data) {
		if(this.currentUser().userId!==userId||this.paused===true||this.currentUser().leave) return false
		if(data.x>this.boardSize||data.x<0||data.y>this.boardSize||data.y<0||!Number.isInteger(data.x)||!Number.isInteger(data.y)) return false
		const cellNumber = data.x + data.y*this.boardSize
		if(this.currentBoard[cellNumber]!==undefined) {
			return this.currentUser().serverAction('game', {
				type: 'error',
				x: data.x,
				y: data.y,
				cell: this.currentBoard[cellNumber],
			})
		}
		this.currentBoard[cellNumber] = this.currentPlayerTurn
		//Проверяем наличие следующего игрока
		const nextPlayer = this.nextPlayer()
		if (nextPlayer===null) { 
			this.finish()
			return
		}
		//Проверка на наличие победителя
		if(this.checkCombo(cellNumber)) {
			this.score[this.currentPlayerTurn][0]++
			if (this.score[this.currentPlayerTurn][0]===this.roundsForWin) {
				this.finish()
			} else {
				this.paused=true
				setTimeout(this.startNewRound ,3000)
			}
		} 
		this.lasttime = Date.now()
		this.players.forEach(user => user.serverAction('game', {
			type: this.paused?'roundFinished':'turn',
			x: data.x,
			y: data.y,
			cell: this.currentPlayerTurn,
			lasttime: this.lasttime,
			nextPlayer: nextPlayer,
		}))

		this.currentPlayerTurn = nextPlayer
	}

	//Вернуть номер следующего игрока (null если все ливнули или остался 1 игрок)
	nextPlayer() {
		let nextPlayer = this.currentPlayerTurn
		for(let i = 0; i < this.players.length; i++) {
			nextPlayer = (nextPlayer+1) % this.players.length
			if (this.players[this.queue[nextPlayer]].leave===false) {
				let counterNotLeavePlayers = 0
				this.players.forEach(user => !user.leave?counterNotLeavePlayers++:null)
				if (counterNotLeavePlayers<2) return null
				return nextPlayer
			}
		}
		return null
	}

	finish() {
		clearInterval(this.interval)
		console.log('match finished '+this.currentPlayerTurn)
		this.players.forEach(user => user.leave===false?user.serverAction('game', {
			type: 'matchFinished',
			currentPlayerTurn: this.currentPlayerTurn,
		}):null)
		this.restartRoom()
	}

	//Проверить на наличие комбинации ячеек
	checkCombo(cellNumber) {
		let countCells = 0
		//По диагонали сверху-слева
		for(let i = -this.cellsForWin +1; i < this.cellsForWin; i++) {
			try {
				if(this.currentBoard[cellNumber+i*this.boardSize+i] === this.currentBoard[cellNumber]) {
					countCells++
					if(countCells===this.cellsForWin) return true
				} else countCells=0
			} catch{}
		}
		//По диагонали сверху-справа
		for(let i = -this.cellsForWin +1; i < this.cellsForWin; i++) {
			try {
				if(this.currentBoard[cellNumber+i*this.boardSize-i] === this.currentBoard[cellNumber]) {
					countCells++
					if(countCells===this.cellsForWin) return true
				} else countCells=0
			} catch{}
		}
		//По вертикали
		for(let i = -this.cellsForWin +1; i < this.cellsForWin; i++) {
			try {
				if(this.currentBoard[cellNumber+i*this.boardSize] === this.currentBoard[cellNumber]) {
					countCells++
					if(countCells===this.cellsForWin) return true
				} else countCells=0
			} catch{}
		}
		//По горизонтали
		for(let i = -this.cellsForWin +1; i < this.cellsForWin; i++) {
			try {
				if(this.currentBoard[cellNumber+i] === this.currentBoard[cellNumber]) {
					countCells++
					if(countCells===this.cellsForWin) return true
				} else countCells=0
			} catch{}
		}
		return false
	}
}

class Minesweeper {
	constructor(props={}, users, restartRoom) {
		if (users.length<2||users.length>3) throw 0
		if (props.boardSizeX<10||props.boardSizeX>50||props.boardSizeY<10||props.boardSizeY>50) throw 0
		//Количество раундов для победы игрока
		this.roundsForWin = props.roundsForWin||30 
		//Размер поля по x
		this.boardSizeX = props.boardSizeX||15 
		//Размер поля по y
		this.boardSizeY = props.boardSizeY||25 
		//Текущий счёт
		this.score = {} 
		//Расположение мин
		this.board = {} 
		// Выжившие / невыжившие игроки
		this.burstUp = {} 
		//Открытые ячейки каждого игрока
		this.currentBoard = [] 
		//Количество мин
		this.minesCount = props.minesCount || 20
		//Игра приостановлена (между раундами или в конце игры)
		this.paused = true 
		//Timestamp начала раунда
		this.roundStartedTimestamp = Date.now()  
		console.log(this.boardSizeX)
		console.log(this.boardSizeY)
		console.log(this.minesCount)

		//Перезагрузить комнату
		this.restartRoom = restartRoom 
		//Сведения об игроках из users
		this.players = users 

		for(let i = 0; i < this.players.length; i++) {
			this.score[i] = [0, 0]
			this.currentBoard[i] = {}
		}
		setTimeout(this.startNewRound, 1000)
	}

	/*
		Events
			roundStarted - начало раунда ex: {roundStarted: (время старта)}
			roundFinished - завершение раунда ex: {currentPlayer: (победитель раунда)}
			explode - подрыв игрока на мине ex: {currentPlayer: (подорвавшийся игрок)}
			progress - прогресс игроков ex: {currentPlayer: (игрок), countCells: (открыто ячеек игроком)}
			openedCells - открыты новые ячейки ex: {cells: {1: 4, 2: 2, 3: 8} (номера открытых ячеек и количество мин вокруг)}
			error - ячейка уже была открыта
			matchFinished - завершение матча
	*/

	info(userId) {
		return {
			roundsForWin: this.roundsForWin,
			boardSizeX: this.boardSizeX,
			boardSizeY: this.boardSizeY,
			minesCount: this.minesCount,
			
			roundStartedTimestamp: this.roundStartedTimestamp,
			paused: this.paused,
			score: this.score,
		}
	}
	currentPlayer = (userId) => {
		for (let playerIndex in this.players) {
			if (this.players[playerIndex].userId===userId) return playerIndex
		}
	}
	startNewRound = () => {
		this.roundStartedTimestamp = Date.now()
		let iterationMinesCount = this.minesCount
		//Генерация мин
		this.board = {}
		while (iterationMinesCount>0) {
			const rand = Math.floor(Math.random()*this.boardSizeX*this.boardSizeY)
			if(this.board[rand]===undefined) {
				this.board[rand]=true
				iterationMinesCount--
			}
		}
		this.paused = false
		for(let i = 0; i < this.players.length; i++) {
			this.currentBoard[i] = {}
			this.score[i][1]=0
		}
		this.burstUp = {}
		this.players.forEach(user => user.serverAction('game', {
			type: 'roundStarted',
			roundStartedTimestamp: this.roundStartedTimestamp,
		}))
		console.log("new round")
	}

	action(userId, data) {
		if(this.paused===true||this.players[this.currentPlayer(userId)].leave) return false
		if(data.cell<0||data.cell>this.boardSizeY*this.boardSizeX||!Number.isInteger(data.cell)) return false
		
		const currentPlayerNumber = this.currentPlayer(userId)
		if (this.burstUp[currentPlayerNumber]===true) return false
		if (this.currentBoard[currentPlayerNumber].hasOwnProperty(data.cell)) return false
		//Проверяем подорвался ли игрок
		if (this.board[data.cell]) {
				this.players.forEach(user => user.userId===userId?user.serverAction('game', {
				type: 'explode',
				currentPlayer: currentPlayerNumber,
				cell: data.cell,
			}): user.serverAction('game', {
				type: 'explode',
				currentPlayer: currentPlayerNumber
			}))
			this.burstUp[currentPlayerNumber]=true
			//Проверяем число всех выживших
			if ((this.players.length - Object.keys(this.burstUp).length) < 2) {
					//Осталось <2 = завершение раунда
					this.paused=true
					this.players.forEach((player, index) => {
						if (this.burstUp[index]===undefined) {
							this.score[index][0]++
							this.players.forEach(user => {
								user.serverAction('game', {
									type: 'roundFinished',
									currentPlayer: index
								})
							})
						}
					})
					
					//Проверка на завершение игры
					if (this.checkWinner()) {
						this.finish()
					} else setTimeout(this.startNewRound ,1000)
				}
		} else {
			//Игрок не подорвался и открыл ячейки
			const openedCells = this.openCell(data.cell)
			const countOpenedCells = Object.keys(openedCells).length
			for (let key in openedCells) {
				this.currentBoard[currentPlayerNumber][key] = true
			}
			this.score[currentPlayerNumber][1]+=countOpenedCells

			this.players.forEach(user => user.userId===userId?
				user.serverAction('game', {
				type: 'openedCells',
				cells: openedCells,
			}):user.serverAction('game', {
				type: 'progress',
				currentPlayer: currentPlayerNumber,
				countCells: countOpenedCells
			}))
			
			//Проверка на закрытие всех клеток
			if (Object.keys(this.currentBoard[currentPlayerNumber]).length>=(this.boardSizeX*this.boardSizeY - this.minesCount)) {
				this.paused = true
				this.score[currentPlayerNumber][0]++
				this.players.forEach(user => {
					user.serverAction('game', {
						type: 'roundFinished',
						currentPlayer: currentPlayerNumber
					})
				})
				//Проверка на завершение игры
				if (this.checkWinner()) {
					this.finish(currentPlayerNumber)
				} else setTimeout(this.startNewRound ,3000)
			}
		}
	}
	
	checkWinner() {
		for(let item in this.score) {
			if (this.score[item][0] >= this.roundsForWin) {
				return true
			}
		}
		return false
	}
	//Открыть ячейку
	openCell = (openedCell) => {
		const result = {}
		const checkCell = (cell, result) => {
			const x = cell%this.boardSizeX
			const y = ~~(cell/this.boardSizeX)
			const minesCount = this.countMinesAroundCell(cell, x, y)
			result[cell] = minesCount
			if (minesCount===0) {
				if (x>0&&result[cell-1]===undefined) checkCell(cell - 1, result)
				if (x+1<this.boardSizeX&&result[cell+1]===undefined) checkCell(cell + 1, result)
				if (y>0&&result[cell - this.boardSizeX]===undefined) checkCell(cell - this.boardSizeX, result)
				if (y+1<this.boardSizeY&&result[cell + this.boardSizeX]===undefined) checkCell(cell + this.boardSizeX, result)
				if (x>0&&y>0&&result[cell - this.boardSizeX - 1]===undefined) checkCell(cell - this.boardSizeX - 1, result)
				if (x>0&&y+1<this.boardSizeY&&result[cell + this.boardSizeX - 1]===undefined) checkCell(cell + this.boardSizeX - 1, result)
				if (x+1<this.boardSizeX&&y>0&&result[cell - this.boardSizeX + 1]===undefined) checkCell(cell - this.boardSizeX + 1, result)
				if (x+1<this.boardSizeX&&y+1<this.boardSizeY&&result[cell + this.boardSizeX + 1]===undefined) checkCell(cell + this.boardSizeX + 1, result)
			} 
		}
		checkCell(openedCell,result)
		return result
	}
	
	countMinesAroundCell(cell, x, y) {
		let counter = 0
		if (x!==0&&this.board[cell - 1]===true) counter++
		if (x+1!==this.boardSizeX&&this.board[cell + 1]===true) counter++
		if (y!==0&&this.board[cell - this.boardSizeX]===true) counter++
		if (y+1!==this.boardSizeY&&this.board[cell + this.boardSizeX]===true) counter++
		if (x!==0&&y!==0&&this.board[cell - this.boardSizeX - 1]===true) counter++
		if (x!==0&&y+1!==this.boardSizeY&&this.board[cell + this.boardSizeX - 1]===true) counter++
		if (x+1!==this.boardSizeX&&y!==0&&this.board[cell - this.boardSizeX + 1]===true) counter++
		if (x+1!==this.boardSizeX&&y+1!==this.boardSizeY&&this.board[cell + this.boardSizeX + 1]===true) counter++
		return counter
	}

	finish(playerNumber) {
		console.log('match finished Minesweeper')
		this.players.forEach(user => user.leave===false?user.serverAction('game', {
			type: 'matchFinished',
			currentPlayer: playerNumber,
		}):null)
		this.restartRoom()
	}
}
