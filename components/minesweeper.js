module.exports = class Minesweeper {
	constructor(props={}, users, restartRoom) {
		if (users.length<2||users.length>5) throw 0
		if (props.boardSizeX<10||props.boardSizeX>50||props.boardSizeY<10||props.boardSizeY>50) throw 0
		if(!Number.isInteger(props.minesCount)|| !Number.isInteger(props.roundsForWin)|| !Number.isInteger(props.boardSizeX)|| !Number.isInteger(props.boardSizeY)) throw 0
		//Раундов для победы 
		this.roundsForWin = props.roundsForWin>=5&&props.roundsForWin<=30?props.roundsForWin:10 
		//Размер поля по x
		this.boardSizeX = props.boardSizeX>=10&&props.boardSizeX<=40?props.boardSizeX:10 
		//Размер поля по y
		this.boardSizeY = props.boardSizeY>=10&&props.boardSizeX<=60?props.boardSizeX:10 
		//Количество мин
		this.minesCount = props.minesCount>=10&&props.minesCount<=props.boardSizeX*props.boardSizeY?props.minesCount:20
		//Текущий счёт
		this.score = {} 
		//Расположение мин
		this.board = {} 
		// Выжившие / невыжившие игроки
		this.burstUp = {} 
		//Открытые ячейки каждого игрока
		this.currentBoard = [] 
		//Игра приостановлена (между раундами или в конце игры)
		this.paused = true 
		//Timestamp начала раунда
		this.roundStartedTimestamp = Date.now()  
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
				this.players.forEach(user => user.serverAction('game', {
				type: 'explode',
				currentPlayer: currentPlayerNumber,
				cell: data.cell,
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
