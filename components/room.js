"use strict";
const Tictactoe = import('./tictactoe')
const Minesweeper = import('./minesweeper')

export default class Room {
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
			gameProps: this.gameProps,
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