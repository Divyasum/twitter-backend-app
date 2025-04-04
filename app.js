const express = require('express')
const app = express()
app.use(express.json())
const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

const middleWareFunctionAuthenticationToken = (request, response, next) => {
  const authHeader = request.headers['authorization']
  let jwtToken
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
    if (jwtToken === undefined) {
      response.status(401)
      response.send('Invalid JWT Token')
    } else {
      jwt.verify(jwtToken, 'MY_SECRET_KEY', async (error, payload) => {
        if (error) {
          response.status(401)
          response.send('Invalid JWT Token')
        } else {
          request.username = payload.username
          request.userId = payload.user_id

          const validUser = `
          SELECT *
          FROM user
          WHERE user_id=${request.userId};` //or WHERE user_id=${payload.userId}
          const validUserResponse = await db.get(validUser)
          if (validUserResponse !== undefined) {
            next()
          } else {
            response.status(401)
            response.send('Invalid JWT Token')
          }
        }
      })
    }
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}

//API1 POST
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const selectUserQuery = `
    SELECT * FROM user WHERE username='${username}';` //it retrieves and helps to check whether the user is already there in database or not...if user already there so it shows to user there you cant use same username because it already exist you can use other....
  const dbUser = await db.get(selectUserQuery)
  //always remember as a rule store encrypted password in database not plain text password
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createUserQuery = `
         INSERT INTO user (username,password,name,gender)
         VALUES
         ('${username}',
         '${hashedPassword}',  
         '${name}',
         '${gender}');`
      await db.run(createUserQuery)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//API2 POST
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `
    SELECT * FROM user WHERE username='${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      //Login Success
      const payload = {username: username, user_id: dbUser.user_id} //or {username}
      const jwtToken = jwt.sign(payload, 'MY_SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//API3 GET
const convertCamel = each => {
  return {
    username: each['username'],
    tweet: each['tweet'],
    dateTime: each['date_time'],
  }
}

app.get(
  '/user/tweets/feed/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    let {userId} = request

    const gettweetQuery = `
    SELECT user.username, tweet.tweet, tweet.date_time
    FROM tweet
     JOIN user ON tweet.user_id=user.user_id
     WHERE tweet.user_id IN (
       SELECT following_user_id FROM follower WHERE follower_user_id=${userId}
     )
     ORDER BY tweet.date_time DESC LIMIT 4
                  `
    const tweetArray = await db.all(gettweetQuery)
    console.log(tweetArray)
    response.send(tweetArray.map(each => convertCamel(each)))
  },
)

//API4 GET
app.get(
  '/user/following/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    const {userId} = request
    try {
      const getName = `
    SELECT user.name
          FROM user
          WHERE user.user_id IN (
            SELECT following_user_id
            FROM follower
            WHERE follower_user_id=${userId}
          
     )`
      const userFollowArray = await db.all(getName)
      response.send(userFollowArray)
    } catch (error) {
      console.error(error)
      response.status(500).send({message: 'Internal Server Error'})
    }
  },
)

//API5 GET
app.get(
  '/user/followers/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    const {userId} = request
    try {
      const getName = `
    SELECT user.name
          FROM user
          WHERE user.user_id IN (
            SELECT follower_user_id
            FROM follower
            WHERE following_user_id=${userId}
          
     )`
      const userFollowArray = await db.all(getName)
      response.send(userFollowArray)
    } catch (error) {
      console.error(error)
      response.status(500).send({message: 'Internal Server Error'})
    }
  },
)

//API6 GET
app.get(
  '/tweets/:tweetId/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    console.log(tweetId, userId)
    try {
      const getTweetQuery = `
    SELECT tweet
          FROM tweet
          WHERE tweet_id =${tweetId} AND user_id IN (SELECT following_user_id
            FROM follower
            WHERE follower_user_id = ${userId}
           
     )`
      const tweetObject = await db.get(getTweetQuery)
      if (tweetObject !== undefined) {
        const tweetObjectQuery = `
     SELECT tweet.tweet,COUNT(DISTINCT like.like_id) AS likes, COUNT(DISTINCT reply.reply_id) AS replies,tweet.date_time AS dateTime
     FROM tweet JOIN like ON tweet.tweet_id=like.tweet_id JOIN reply ON reply.tweet_id=tweet.tweet_id
     WHERE tweet.tweet_id=${tweetId}`

        const tweetObjectResponse = await db.get(tweetObjectQuery)
        response.send(tweetObjectResponse)
      } else {
        response.status(401).send('Invalid Request')
      }
    } catch (error) {
      console.log(error)
      response.status(500).send({message: 'Internal Server Error'})
    }
  },
)

//API7 GET
app.get(
  '/tweets/:tweetId/likes/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    console.log(tweetId, userId)
    try {
      const getTweetQuery = `
    SELECT tweet
          FROM tweet
          WHERE tweet_id =${tweetId} AND user_id IN (SELECT following_user_id
            FROM follower
            WHERE follower_user_id = ${userId}
           
     )`
      const tweetObject = await db.get(getTweetQuery)
      if (tweetObject !== undefined) {
        const tweetObjectQuery = `
        SELECT user.username
        FROM user JOIN like ON user.user_id=like.user_id
        WHERE like.tweet_id=${tweetId};`
        const tweetObjectResponse = await db.all(tweetObjectQuery)
        response.send({
          likes: tweetObjectResponse.map(each => each['username']),
        })
      } else {
        response.status(401).send('Invalid Request')
      }
    } catch (error) {
      console.log(error)
      response.status(500).send({message: 'Internal Server Error'})
    }
  },
)

//API8 GET

const replyDataWithName = each => {
  return {
    name: each['name'],
    reply: each['reply'],
  }
}

app.get(
  '/tweets/:tweetId/replies/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    console.log(tweetId, userId)
    try {
      const getTweetQuery = `
    SELECT tweet
          FROM tweet
          WHERE tweet_id =${tweetId} AND user_id IN (SELECT following_user_id
            FROM follower
            WHERE follower_user_id = ${userId}
           
     )`
      const tweetObject = await db.get(getTweetQuery)
      if (tweetObject !== undefined) {
        const tweetObjectQuery = `
        SELECT user.name, reply.reply
        FROM user JOIN reply ON user.user_id=reply.user_id
        WHERE reply.tweet_id=${tweetId};`
        const tweetObjectResponse = await db.all(tweetObjectQuery)
        response.send({
          replies: tweetObjectResponse.map(each => replyDataWithName(each)),
        })
      } else {
        response.status(401).send('Invalid Request')
      }
    } catch (error) {
      console.log(error)
      response.status(500).send({message: 'Internal Server Error'})
    }
  },
)

//API9 GET
app.get(
  '/user/tweets/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    const {userId} = request
    const allTweetOfUser = `
    SELECT tweet.tweet,COUNT(DISTINCT like.like_id) AS likes,COUNT(DISTINCT reply.reply_id) AS replies,tweet.date_time AS dateTime
    FROM tweet LEFT OUTER JOIN like ON tweet.tweet_id=like.tweet_id LEFT OUTER JOIN reply ON reply.tweet_id=tweet.tweet_id
    WHERE tweet.user_id=${userId}
    GROUP BY tweet.tweet_id;`
    const allTweetResponse = await db.all(allTweetOfUser)
    response.send(allTweetResponse)
  },
)

//API10 POST
app.post(
  '/user/tweets/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    const {tweet} = request.body
    const {userId} = request
    const currentDate = new Date()

    const date = currentDate.toISOString().replace('T', ' ')
    // tweet_id will generate automaticlly
    const createTweet = `
  INSERT INTO tweet (tweet,user_id,date_time) 
  VALUES('${tweet}',${userId},'${date}');`
    await db.run(createTweet)
    response.send('Created a Tweet')
  },
)

//API11 DELETE
app.delete(
  '/tweets/:tweetId/',
  middleWareFunctionAuthenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    const getTweetQuery = `
    SELECT tweet
          FROM tweet
          WHERE tweet_id =${tweetId} AND user_id= ${userId}
           
           
     `
    const tweetObject = await db.get(getTweetQuery)
    if (tweetObject !== undefined) {
      const deleteTweet = `
        DELETE 
        FROM tweet
        WHERE tweet_id=${tweetId};
        `

      await db.run(deleteTweet)
      response.send('Tweet Removed')
    } else {
      response.status(401).send('Invalid Request')
    }
  },
)

module.exports = app
