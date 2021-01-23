module.exports = class Tictactoe {
	constructor(props={}, users, restartRoom) {
		if (users.length<2||users.length>3) throw 0
		if(!Number.isInteger(props.timeTurn)|| !Number.isInteger(props.roundsForWin)|| !Number.isInteger(props.boardSize)|| !Number.isInteger(props.cellsForWin)) throw 0
		//Время на ход
		this.timeTurn = props.timeTurn>=3&&props.timeTurn<=60?props.timeTurn*1000:20000 
		//Количество раундов для победы игрока
		this.roundsForWin = props.roundsForWin>=5&&props.roundsForWin<=30?props.roundsForWin:10 
		//Размер поля
		this.boardSize = props.boardSize>=3&&props.boardSize<=30?props.boardSize:15 
		//Количество ячеек в ряд для победы
		this.cellsForWin = props.cellsForWin>=3&&props.boardSize>=props.cellsForWin?props.cellsForWin:3 
		//Последовательность, в которой игроки совершают ход
		this.queue = [] 
		//Игрок, который должен ходить (по массиву queue)
		this.currentPlayerTurn = 0 
		//Текущий счёт
		this.score = {} 
		//Текущие данные поля
		this.currentBoard = {} 
		//Timestamp последнего события 
		this.lasttime = Date.now() 
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
