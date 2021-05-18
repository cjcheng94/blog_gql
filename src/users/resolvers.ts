import { default as mongodb } from "mongodb";
import { AuthenticationError } from "apollo-server";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { QueryResolvers, UserResolvers } from "../gen-types";
import { WithIndexSignature } from "Utils";
import { NotFoundError, ConflictError } from "../errors";
import dotenv from "dotenv";
dotenv.config();

const { ObjectId } = mongodb;
interface Resolvers extends WithIndexSignature {
  Query: QueryResolvers;
  User: UserResolvers;
}

const resolvers: Resolvers = {
  Query: {
    async users(parent, args, context) {
      const data = await context.db
        .collection("users")
        .find()
        .toArray();
      return data;
    },

    async user(parent, args, context) {
      const { username } = args;
      const data = await context.db.collection("users").findOne({ username });
      // cannot find user
      if (data === null) {
        throw new NotFoundError("Cannot find user");
      }
      return data;
    },

    async userLogin(parent, args, context) {
      const { username, password } = args;
      const { db } = context;
      const targetUser = await db.collection("users").findOne({ username });
      // cannot find user
      if (targetUser === null) {
        throw new AuthenticationError("Auth failed");
      }
      // Found user, use bcrypt to compare passwords
      const result = await bcrypt.compare(password, targetUser.password);
      // Wrong password
      if (!result) {
        throw new AuthenticationError("Auth failed");
      }
      const token = jwt.sign(
        {
          username: targetUser.username,
          userId: targetUser._id
        },
        process.env.JWT_KEY as string,
        { expiresIn: "2 days" }
      );
      // Success, grant token
      return token;
    },

    async userSignup(parent, args, context) {
      const { username, password } = args;
      const { db } = context;
      // Query username for duplicates
      const dupeUser = await db.collection("users").findOne({ username });
      // Username already exists
      if (dupeUser !== null) {
        throw new ConflictError("username already exists");
      }
      // Username ok, hash password
      const hash = await bcrypt.hash(password, 10);
      // Create new user
      const newUser = {
        _id: new ObjectId(),
        posts: [],
        username,
        password: hash
      };
      const dbRes = await db.collection("users").insertOne(newUser);
      // Error creating user
      if (dbRes.insertedCount < 1) {
        // Effectively INTERNAL_SERVER_ERROR type
        throw new Error("Internal server error");
      }
      const newUserData = dbRes.ops[0];
      // Success, return newly created user
      return newUserData;
    }
  },

  User: {
    async posts(user, args, context) {
      const { posts, _id } = user;
      // User has no posts
      if (!posts || posts.length < 1) {
        return [];
      }
      const userObjId = new ObjectId(_id);
      const data = await context.db
        .collection("posts")
        .find({ author: userObjId })
        .toArray();
      return data;
    }
  }
};

export default resolvers;
